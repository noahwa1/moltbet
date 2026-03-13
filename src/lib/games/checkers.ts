import { getDb } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import { distributeWinnings, recordLoss } from "@/lib/economics";

// In-memory live state for spectating
const liveCheckersGames = new Map<string, CheckersGameState>();

export function getLiveCheckersGame(id: string): CheckersGameState | undefined {
  return liveCheckersGames.get(id);
}

export function listLiveCheckersGames(): CheckersGameState[] {
  return Array.from(liveCheckersGames.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CellValue = null | "r" | "b" | "R" | "B";

export interface CheckersMove {
  playerId: string;
  playerName: string;
  color: "red" | "black";
  move: string; // e.g. "2,1-3,2" or "2,1-4,3-6,5" for multi-jump
  captured: number;
  promoted: boolean;
  comment?: string;
  moveNumber: number;
}

export interface CheckersPlayer {
  agentId: string;
  name: string;
  avatar: string;
  color: "red" | "black";
  elo: number;
}

export interface CheckersGameState {
  id: string;
  board: CellValue[][];       // board[row][col], 8x8
  players: [CheckersPlayer, CheckersPlayer];
  currentPlayerIndex: number; // 0 or 1
  moveHistory: CheckersMove[];
  redPieces: number;
  blackPieces: number;
  redKings: number;
  blackKings: number;
  winner: string | null;      // agentId or "draw"
  status: "live" | "finished";
  moveCount: number;
  movesSinceCapture: number;
}

interface AgentRecord {
  id: string;
  name: string;
  type: string;
  model: string | null;
  personality: string | null;
  endpoint: string | null;
  api_key: string | null;
  avatar: string;
  elo: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOARD_SIZE = 8;
const PRIZE_POOL = 400;
const EXTERNAL_TIMEOUT_MS = 15_000;
const DRAW_THRESHOLD = 80; // moves without capture or king => draw

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function createInitialBoard(): CellValue[][] {
  const board: CellValue[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null) as CellValue[],
  );

  // Red pieces on rows 0-2, dark squares only
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if ((row + col) % 2 === 1) {
        board[row][col] = "r";
      }
    }
  }

  // Black pieces on rows 5-7, dark squares only
  for (let row = 5; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if ((row + col) % 2 === 1) {
        board[row][col] = "b";
      }
    }
  }

  return board;
}

function isPlayerPiece(cell: CellValue, color: "red" | "black"): boolean {
  if (color === "red") return cell === "r" || cell === "R";
  return cell === "b" || cell === "B";
}

function isOpponentPiece(cell: CellValue, color: "red" | "black"): boolean {
  if (color === "red") return cell === "b" || cell === "B";
  return cell === "r" || cell === "R";
}

function isKing(cell: CellValue): boolean {
  return cell === "R" || cell === "B";
}

function getForwardDirections(color: "red" | "black"): number[] {
  // Red moves down (increasing row), Black moves up (decreasing row)
  return color === "red" ? [1] : [-1];
}

function getAllDirections(): number[] {
  return [1, -1];
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Get all simple (non-capture) moves for a piece at (row, col). */
function getSimpleMoves(
  board: CellValue[][],
  row: number,
  col: number,
  color: "red" | "black",
): string[] {
  const piece = board[row][col];
  if (!piece) return [];

  const rowDirs = isKing(piece) ? getAllDirections() : getForwardDirections(color);
  const moves: string[] = [];

  for (const dr of rowDirs) {
    for (const dc of [-1, 1]) {
      const nr = row + dr;
      const nc = col + dc;
      if (inBounds(nr, nc) && board[nr][nc] === null) {
        moves.push(`${row},${col}-${nr},${nc}`);
      }
    }
  }

  return moves;
}

/** Get all capture sequences (including multi-jumps) for a piece at (row, col). */
function getCaptureSequences(
  board: CellValue[][],
  row: number,
  col: number,
  color: "red" | "black",
): string[] {
  const piece = board[row][col];
  if (!piece) return [];

  const sequences: string[] = [];

  function dfs(
    currentBoard: CellValue[][],
    r: number,
    c: number,
    path: string[],
    pieceIsKing: boolean,
  ): void {
    const rowDirs = pieceIsKing ? getAllDirections() : getForwardDirections(color);
    let foundCapture = false;

    for (const dr of rowDirs) {
      for (const dc of [-1, 1]) {
        const midR = r + dr;
        const midC = c + dc;
        const landR = r + 2 * dr;
        const landC = c + 2 * dc;

        if (
          inBounds(landR, landC) &&
          isOpponentPiece(currentBoard[midR][midC], color) &&
          currentBoard[landR][landC] === null
        ) {
          foundCapture = true;

          // Make the jump on a copy
          const newBoard = currentBoard.map((row) => [...row]);
          newBoard[r][c] = null;
          newBoard[midR][midC] = null;
          // Check for promotion
          let promoted = pieceIsKing;
          if (!promoted) {
            if (color === "red" && landR === BOARD_SIZE - 1) promoted = true;
            if (color === "black" && landR === 0) promoted = true;
          }
          newBoard[landR][landC] = promoted
            ? (color === "red" ? "R" : "B")
            : (color === "red" ? "r" : "b");

          const newPath = [...path, `${landR},${landC}`];

          // If piece just got promoted during this jump, stop the multi-jump
          if (promoted && !pieceIsKing) {
            sequences.push(newPath.join("-"));
          } else {
            // Continue looking for more jumps
            dfs(newBoard, landR, landC, newPath, promoted);
          }
        }
      }
    }

    // If no further captures found, record the path if it has at least one jump
    if (!foundCapture && path.length > 1) {
      sequences.push(path.join("-"));
    }
  }

  dfs(board, row, col, [`${row},${col}`], isKing(piece));

  return sequences;
}

/** Get all legal moves for a player. Captures are mandatory if available. */
function getLegalMoves(board: CellValue[][], color: "red" | "black"): string[] {
  const captures: string[] = [];
  const simpleMoves: string[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (isPlayerPiece(board[row][col], color)) {
        captures.push(...getCaptureSequences(board, row, col, color));
        simpleMoves.push(...getSimpleMoves(board, row, col, color));
      }
    }
  }

  // Mandatory capture rule: if any captures exist, only captures are legal
  return captures.length > 0 ? captures : simpleMoves;
}

/** Apply a move string to the board. Returns { captured, promoted }. */
function applyMove(
  board: CellValue[][],
  move: string,
  color: "red" | "black",
): { captured: number; promoted: boolean } {
  const parts = move.split("-");
  let captured = 0;
  let promoted = false;

  for (let i = 0; i < parts.length - 1; i++) {
    const [fromR, fromC] = parts[i].split(",").map(Number);
    const [toR, toC] = parts[i + 1].split(",").map(Number);

    const piece = board[fromR][fromC];
    board[fromR][fromC] = null;

    // Check if this is a capture (jump of 2 squares)
    if (Math.abs(toR - fromR) === 2) {
      const midR = (fromR + toR) / 2;
      const midC = (fromC + toC) / 2;
      board[midR][midC] = null;
      captured++;
    }

    // Check for king promotion
    let newPiece = piece;
    if (color === "red" && toR === BOARD_SIZE - 1 && !isKing(piece)) {
      newPiece = "R";
      promoted = true;
    }
    if (color === "black" && toR === 0 && !isKing(piece)) {
      newPiece = "B";
      promoted = true;
    }

    board[toR][toC] = newPiece;
  }

  return { captured, promoted };
}

function countPieces(board: CellValue[][]): {
  redPieces: number;
  blackPieces: number;
  redKings: number;
  blackKings: number;
} {
  let redPieces = 0;
  let blackPieces = 0;
  let redKings = 0;
  let blackKings = 0;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell === "r") redPieces++;
      else if (cell === "R") { redPieces++; redKings++; }
      else if (cell === "b") blackPieces++;
      else if (cell === "B") { blackPieces++; blackKings++; }
    }
  }

  return { redPieces, blackPieces, redKings, blackKings };
}

function boardToAscii(board: CellValue[][]): string {
  const lines: string[] = [];
  lines.push("    0   1   2   3   4   5   6   7");
  lines.push("  +---+---+---+---+---+---+---+---+");
  for (let row = 0; row < BOARD_SIZE; row++) {
    const cells = board[row].map((cell) => {
      if (cell === null) return " ";
      return cell;
    });
    lines.push(`${row} | ${cells.join(" | ")} |`);
    lines.push("  +---+---+---+---+---+---+---+---+");
  }
  lines.push("");
  lines.push("Pieces: r = red, b = black, R = Red King, B = Black King");
  lines.push("Only dark squares (row+col is odd) are playable.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

interface CheckersActionResult {
  move: string;
  comment?: string;
}

function buildCheckersPrompt(
  state: CheckersGameState,
  playerIndex: number,
): string {
  const player = state.players[playerIndex];
  const opponent = state.players[1 - playerIndex];
  const legalMoves = getLegalMoves(state.board, player.color);
  const pieces = countPieces(state.board);

  const recentMoves = state.moveHistory
    .slice(-10)
    .map((m) => `  ${m.playerName} (${m.color}): ${m.move}${m.captured > 0 ? ` [captured ${m.captured}]` : ""}${m.promoted ? " [KINGED!]" : ""}${m.comment ? ` - "${m.comment}"` : ""}`)
    .join("\n");

  const hasCaptures = legalMoves.some((m) => {
    const parts = m.split("-");
    const [fromR, fromC] = parts[0].split(",").map(Number);
    const [toR, toC] = parts[1].split(",").map(Number);
    return Math.abs(toR - fromR) === 2;
  });

  return `You are playing Checkers!

=== YOUR INFO ===
Name: ${player.name}
Your color: ${player.color}
Your pieces: ${player.color === "red" ? pieces.redPieces : pieces.blackPieces} (${player.color === "red" ? pieces.redKings : pieces.blackKings} kings)
ELO: ${player.elo}

=== OPPONENT ===
Name: ${opponent.name} ${opponent.avatar}
Color: ${opponent.color}
Pieces: ${opponent.color === "red" ? pieces.redPieces : pieces.blackPieces} (${opponent.color === "red" ? pieces.redKings : pieces.blackKings} kings)
ELO: ${opponent.elo}

=== CURRENT BOARD ===
${boardToAscii(state.board)}

=== MOVE HISTORY (last 10) ===
${recentMoves || "(no moves yet - you're going first!)"}

=== GAME INFO ===
Move #${state.moveCount + 1}
Moves since last capture: ${state.movesSinceCapture} (draw at ${DRAW_THRESHOLD})
${hasCaptures ? "*** CAPTURES ARE MANDATORY - you must jump! ***" : ""}

=== LEGAL MOVES ===
${legalMoves.join("\n")}

Move format: "row,col-row,col" for simple moves, "row,col-row,col-row,col" for multi-jumps.
${player.color === "red" ? "Red moves DOWN the board (increasing row numbers)." : "Black moves UP the board (decreasing row numbers)."}
Kings can move in any diagonal direction.

Respond with EXACTLY this JSON format, nothing else:
{"move": "<move string from legal moves above>", "comment": "<brief in-character trash talk or commentary, max 80 chars>"}`;
}

function parseCheckersResponse(text: string, legalMoves: string[]): CheckersActionResult {
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { move: legalMoves[Math.floor(Math.random() * legalMoves.length)], comment: "*fumbles the piece*" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const move = typeof parsed.move === "string" ? parsed.move.trim() : "";
    const comment = typeof parsed.comment === "string" ? parsed.comment.slice(0, 80) : undefined;

    if (legalMoves.includes(move)) {
      return { move, comment };
    }

    // Try to find a close match (agent might format slightly differently)
    const normalized = move.replace(/\s/g, "");
    const match = legalMoves.find((lm) => lm.replace(/\s/g, "") === normalized);
    if (match) {
      return { move: match, comment };
    }

    // Fallback: pick a random legal move
    return {
      move: legalMoves[Math.floor(Math.random() * legalMoves.length)],
      comment: comment ?? "*makes an illegal move, forced to play something else*",
    };
  } catch {
    return { move: legalMoves[Math.floor(Math.random() * legalMoves.length)], comment: "*confused clicking*" };
  }
}

async function getBuiltinAction(
  agent: AgentRecord,
  state: CheckersGameState,
  playerIndex: number,
): Promise<CheckersActionResult> {
  const prompt = buildCheckersPrompt(state, playerIndex);
  const player = state.players[playerIndex];
  const legalMoves = getLegalMoves(state.board, player.color);

  const systemPrompt = agent.personality
    ? `${agent.personality} You are now playing Checkers. Be strategic but stay in character. Show your personality!`
    : "You are a competitive Checkers player. Play smart and have fun with trash talk.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseCheckersResponse(text, legalMoves);
  } catch (error) {
    console.error(`[Checkers] Builtin agent ${agent.name} error:`, error);
    return { move: legalMoves[Math.floor(Math.random() * legalMoves.length)], comment: "*connection issues*" };
  }
}

async function getExternalAction(
  agent: AgentRecord,
  state: CheckersGameState,
  playerIndex: number,
): Promise<CheckersActionResult> {
  const prompt = buildCheckersPrompt(state, playerIndex);
  const player = state.players[playerIndex];
  const legalMoves = getLegalMoves(state.board, player.color);

  const payload = {
    game_id: state.id,
    game_type: "checkers",
    state: {
      board: state.board,
      your_color: player.color,
      legal_moves: legalMoves,
      red_pieces: state.redPieces,
      black_pieces: state.blackPieces,
      red_kings: state.redKings,
      black_kings: state.blackKings,
      move_count: state.moveCount,
      move_history: state.moveHistory.map(
        (m) => `${m.playerName}(${m.color}):${m.move}`,
      ),
    },
    legal_actions: legalMoves,
    prompt,
    time_limit_ms: EXTERNAL_TIMEOUT_MS,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (agent.api_key) headers["Authorization"] = `Bearer ${agent.api_key}`;

    const res = await fetch(agent.endpoint!, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}`);
    }

    const data = await res.json();
    const text = JSON.stringify(data);
    return parseCheckersResponse(text, legalMoves);
  } catch (error) {
    console.error(`[Checkers] External agent ${agent.name} error:`, error);
    return { move: legalMoves[Math.floor(Math.random() * legalMoves.length)], comment: "*timed out*" };
  }
}

async function getCheckersAgentAction(
  agent: AgentRecord,
  state: CheckersGameState,
  playerIndex: number,
): Promise<CheckersActionResult> {
  if (agent.type === "external" && agent.endpoint) {
    return getExternalAction(agent, state, playerIndex);
  }
  return getBuiltinAction(agent, state, playerIndex);
}

// ---------------------------------------------------------------------------
// ELO calculation
// ---------------------------------------------------------------------------

function calculateEloChange(winnerElo: number, loserElo: number): { winnerDelta: number; loserDelta: number } {
  const K = 32;
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 - expectedWinner;

  const winnerDelta = Math.round(K * (1 - expectedWinner));
  const loserDelta = Math.round(K * (0 - expectedLoser));

  return { winnerDelta, loserDelta };
}

// ---------------------------------------------------------------------------
// Game engine
// ---------------------------------------------------------------------------

function loadAgents(agentIds: string[]): AgentRecord[] {
  const db = getDb();
  return agentIds.map((id) => {
    const row = db
      .prepare("SELECT id, name, type, model, personality, endpoint, api_key, avatar, elo FROM agents WHERE id = ?")
      .get(id) as AgentRecord | undefined;
    if (!row) throw new Error(`Agent not found: ${id}`);
    return row;
  });
}

/** Run a complete Checkers game. Returns the final game state. */
export async function playCheckersGame(playerIds: string[]): Promise<CheckersGameState> {
  if (playerIds.length !== 2) {
    throw new Error("Checkers requires exactly 2 players");
  }

  const agents = loadAgents(playerIds);
  const gameId = uuid();
  const db = getDb();

  // Randomly assign red and black
  const first = Math.random() < 0.5 ? 0 : 1;

  // Create the DB record
  db.prepare(
    "INSERT INTO checkers_games (id, status, player_a, player_b, state, scheduled_at, started_at, created_at) VALUES (?, 'live', ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))",
  ).run(gameId, agents[first].id, agents[1 - first].id, "{}");

  const initialBoard = createInitialBoard();
  const initialPieces = countPieces(initialBoard);

  // Initialize state
  const state: CheckersGameState = {
    id: gameId,
    board: initialBoard,
    players: [
      {
        agentId: agents[first].id,
        name: agents[first].name,
        avatar: agents[first].avatar,
        color: "red",
        elo: agents[first].elo,
      },
      {
        agentId: agents[1 - first].id,
        name: agents[1 - first].name,
        avatar: agents[1 - first].avatar,
        color: "black",
        elo: agents[1 - first].elo,
      },
    ],
    currentPlayerIndex: 0, // Red always goes first
    moveHistory: [],
    redPieces: initialPieces.redPieces,
    blackPieces: initialPieces.blackPieces,
    redKings: initialPieces.redKings,
    blackKings: initialPieces.blackKings,
    winner: null,
    status: "live",
    moveCount: 0,
    movesSinceCapture: 0,
  };

  console.log(`[Checkers] Game ${gameId} started! ${state.players[0].name} (red) vs ${state.players[1].name} (black)`);

  // Broadcast initial state
  liveCheckersGames.set(gameId, deepCopyState(state));

  // Game loop - max moves limited by draw rule
  const MAX_TOTAL_MOVES = 500; // safety limit
  for (let moveNum = 0; moveNum < MAX_TOTAL_MOVES; moveNum++) {
    const playerIndex = state.currentPlayerIndex;
    const player = state.players[playerIndex];
    const agent = agents.find((a) => a.id === player.agentId)!;

    // Check if current player has any legal moves
    const legalMoves = getLegalMoves(state.board, player.color);
    if (legalMoves.length === 0) {
      // No legal moves - opponent wins
      state.winner = state.players[1 - playerIndex].agentId;
      state.status = "finished";
      console.log(`[Checkers] ${player.name} has no legal moves. ${state.players[1 - playerIndex].name} wins!`);
      break;
    }

    // Get agent's move
    const result = await getCheckersAgentAction(agent, state, playerIndex);

    // Apply the move
    const { captured, promoted } = applyMove(state.board, result.move, player.color);

    const move: CheckersMove = {
      playerId: player.agentId,
      playerName: player.name,
      color: player.color,
      move: result.move,
      captured,
      promoted,
      comment: result.comment,
      moveNumber: moveNum + 1,
    };
    state.moveHistory.push(move);
    state.moveCount++;

    // Update draw counter
    if (captured > 0) {
      state.movesSinceCapture = 0;
    } else {
      state.movesSinceCapture++;
    }

    // Recount pieces
    const pieces = countPieces(state.board);
    state.redPieces = pieces.redPieces;
    state.blackPieces = pieces.blackPieces;
    state.redKings = pieces.redKings;
    state.blackKings = pieces.blackKings;

    console.log(
      `[Checkers] ${player.name} (${player.color}): ${result.move}${captured > 0 ? ` [captured ${captured}]` : ""}${promoted ? " [KINGED!]" : ""}${result.comment ? ` - "${result.comment}"` : ""}`,
    );

    // Update live state for spectators
    liveCheckersGames.set(gameId, deepCopyState(state));

    // Check win conditions
    if (state.redPieces === 0) {
      state.winner = state.players.find((p) => p.color === "black")!.agentId;
      state.status = "finished";
      console.log(`[Checkers] All red pieces captured! ${state.players.find((p) => p.color === "black")!.name} wins!`);
      break;
    }

    if (state.blackPieces === 0) {
      state.winner = state.players.find((p) => p.color === "red")!.agentId;
      state.status = "finished";
      console.log(`[Checkers] All black pieces captured! ${state.players.find((p) => p.color === "red")!.name} wins!`);
      break;
    }

    // Check draw condition
    if (state.movesSinceCapture >= DRAW_THRESHOLD) {
      state.winner = "draw";
      state.status = "finished";
      console.log(`[Checkers] Draw! ${DRAW_THRESHOLD} moves without a capture.`);
      break;
    }

    // Switch player
    state.currentPlayerIndex = 1 - playerIndex;

    // Update DB periodically (every 5 moves)
    if (moveNum % 5 === 4) {
      db.prepare(
        "UPDATE checkers_games SET state = ? WHERE id = ?",
      ).run(JSON.stringify(state), gameId);
    }

    // Delay between moves for spectators
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Final state update
  liveCheckersGames.set(gameId, deepCopyState(state));

  // Finish the game
  finishCheckersGame(state, agents, db);

  // Remove from live games after a short delay so spectators can see the result
  setTimeout(() => {
    liveCheckersGames.delete(gameId);
  }, 10_000);

  return state;
}

function finishCheckersGame(
  state: CheckersGameState,
  agents: AgentRecord[],
  db: ReturnType<typeof getDb>,
): void {
  const isDraw = state.winner === "draw";
  const winnerAgent = isDraw ? null : agents.find((a) => a.id === state.winner)!;
  const loserAgent = isDraw ? null : agents.find((a) => a.id !== state.winner)!;

  // Build result summary
  const resultSummary = {
    winner: isDraw ? "draw" : {
      agentId: winnerAgent!.id,
      name: winnerAgent!.name,
    },
    totalMoves: state.moveCount,
    redPieces: state.redPieces,
    blackPieces: state.blackPieces,
    redKings: state.redKings,
    blackKings: state.blackKings,
    board: boardToAscii(state.board),
  };

  // Update the game record
  db.prepare(
    "UPDATE checkers_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(state), JSON.stringify(resultSummary), state.id);

  // Update agent stats
  for (const player of state.players) {
    db.prepare(
      "UPDATE agents SET games_played = games_played + 1 WHERE id = ?",
    ).run(player.agentId);
  }

  if (isDraw) {
    // Both players get a draw
    for (const player of state.players) {
      db.prepare("UPDATE agents SET draws = draws + 1 WHERE id = ?").run(player.agentId);
    }
    // Split prize pool on draw
    const halfPrize = Math.floor(PRIZE_POOL / 2);
    for (const player of state.players) {
      distributeWinnings(player.agentId, state.id, "checkers", halfPrize);
    }
  } else {
    // Winner
    db.prepare("UPDATE agents SET wins = wins + 1 WHERE id = ?").run(winnerAgent!.id);
    distributeWinnings(winnerAgent!.id, state.id, "checkers", PRIZE_POOL);

    // ELO update
    const { winnerDelta, loserDelta } = calculateEloChange(winnerAgent!.elo, loserAgent!.elo);
    db.prepare("UPDATE agents SET elo = elo + ? WHERE id = ?").run(winnerDelta, winnerAgent!.id);
    db.prepare("UPDATE agents SET elo = elo + ? WHERE id = ?").run(loserDelta, loserAgent!.id);

    // Loser
    db.prepare("UPDATE agents SET losses = losses + 1 WHERE id = ?").run(loserAgent!.id);
    recordLoss(loserAgent!.id, state.id, "checkers", 0);

    console.log(
      `[Checkers] ELO: ${winnerAgent!.name} ${winnerAgent!.elo} -> ${winnerAgent!.elo + winnerDelta}, ` +
      `${loserAgent!.name} ${loserAgent!.elo} -> ${loserAgent!.elo + loserDelta}`,
    );
  }

  // Settle bets
  settleCheckersBets(state.id, state.winner);

  console.log(`[Checkers] Game ${state.id} finished.`);
}

function settleCheckersBets(gameId: string, winner: string | null): void {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM bets WHERE game_id = ? AND game_type = 'checkers' AND status = 'pending'")
    .all(gameId) as Array<{
    id: string;
    user_id: string;
    agent_id: string;
    amount: number;
    odds: number;
  }>;

  const isDraw = winner === "draw";

  for (const bet of bets) {
    if (isDraw) {
      // Refund on draw
      db.prepare("UPDATE bets SET status = 'refunded', payout = ? WHERE id = ?").run(bet.amount, bet.id);
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(bet.amount, bet.user_id);
    } else if (bet.agent_id === winner) {
      const payout = Math.round(bet.amount * bet.odds);
      db.prepare("UPDATE bets SET status = 'won', payout = ? WHERE id = ?").run(payout, bet.id);
      db.prepare("UPDATE users SET balance = balance + ?, total_won = total_won + ? WHERE id = ?").run(
        payout,
        payout,
        bet.user_id,
      );
    } else {
      db.prepare("UPDATE bets SET status = 'lost', payout = 0 WHERE id = ?").run(bet.id);
      db.prepare("UPDATE users SET total_lost = total_lost + ? WHERE id = ?").run(
        bet.amount,
        bet.user_id,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function deepCopyState(state: CheckersGameState): CheckersGameState {
  return {
    ...state,
    board: state.board.map((row) => [...row]),
    players: [{ ...state.players[0] }, { ...state.players[1] }],
    moveHistory: [...state.moveHistory],
  };
}
