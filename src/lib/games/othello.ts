import { getDb } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import { distributeWinnings, recordLoss } from "@/lib/economics";

// In-memory live state for spectating
const liveOthelloGames = new Map<string, OthelloGameState>();

export function getLiveOthelloGame(id: string): OthelloGameState | undefined {
  return liveOthelloGames.get(id);
}

export function listLiveOthelloGames(): OthelloGameState[] {
  return Array.from(liveOthelloGames.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CellValue = null | "B" | "W";

export interface OthelloMove {
  playerId: string;
  playerName: string;
  color: "B" | "W";
  position: string;       // e.g. "c4"
  flippedSquares: string[]; // squares that were flipped by this move
  comment?: string;
  moveNumber: number;
}

export interface OthelloPlayer {
  agentId: string;
  name: string;
  avatar: string;
  color: "B" | "W";
  elo: number;
}

export interface OthelloGameState {
  id: string;
  board: CellValue[][];        // board[row][col], row 0 = top (row 1 in chess notation)
  players: [OthelloPlayer, OthelloPlayer];
  currentPlayerIndex: number;  // 0 or 1
  moveHistory: OthelloMove[];
  blackCount: number;
  whiteCount: number;
  lastMove: {
    position: string;
    flippedSquares: string[];
  } | null;
  winner: string | null;       // agentId or "draw"
  status: "live" | "finished";
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

const anthropic = new Anthropic();

const COLS = "abcdefgh";
const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function createInitialBoard(): CellValue[][] {
  const board: CellValue[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null) as CellValue[],
  );
  // Starting position: d4=W, e4=B, d5=B, e5=W
  // In 0-indexed: row 3 col 3 = d4, row 3 col 4 = e4, row 4 col 3 = d5, row 4 col 4 = e5
  board[3][3] = "W";
  board[3][4] = "B";
  board[4][3] = "B";
  board[4][4] = "W";
  return board;
}

function posToCoords(pos: string): [number, number] | null {
  if (pos.length < 2 || pos.length > 2) return null;
  const col = COLS.indexOf(pos[0]);
  const row = parseInt(pos[1], 10) - 1;
  if (col < 0 || col >= BOARD_SIZE || isNaN(row) || row < 0 || row >= BOARD_SIZE) return null;
  return [row, col];
}

function coordsToPos(row: number, col: number): string {
  return `${COLS[col]}${row + 1}`;
}

/** Returns the list of squares that would be flipped if `color` plays at (row, col). Empty list means invalid move. */
function getFlips(board: CellValue[][], row: number, col: number, color: "B" | "W"): [number, number][] {
  if (board[row][col] !== null) return [];

  const opponent: "B" | "W" = color === "B" ? "W" : "B";
  const allFlips: [number, number][] = [];

  for (const [dr, dc] of DIRECTIONS) {
    const lineFlips: [number, number][] = [];
    let r = row + dr;
    let c = col + dc;

    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === opponent) {
      lineFlips.push([r, c]);
      r += dr;
      c += dc;
    }

    // Valid only if we ended on our own color (and flipped at least one)
    if (lineFlips.length > 0 && r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === color) {
      allFlips.push(...lineFlips);
    }
  }

  return allFlips;
}

/** Returns all legal moves for a given color, with their flip lists. */
function getLegalMoves(board: CellValue[][], color: "B" | "W"): { pos: string; row: number; col: number; flips: [number, number][] }[] {
  const moves: { pos: string; row: number; col: number; flips: [number, number][] }[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const flips = getFlips(board, row, col, color);
      if (flips.length > 0) {
        moves.push({ pos: coordsToPos(row, col), row, col, flips });
      }
    }
  }

  return moves;
}

function countPieces(board: CellValue[][]): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] === "B") black++;
      else if (board[row][col] === "W") white++;
    }
  }
  return { black, white };
}

function boardToAscii(board: CellValue[][]): string {
  const lines: string[] = [];
  lines.push("    a   b   c   d   e   f   g   h");
  lines.push("  +---+---+---+---+---+---+---+---+");
  for (let row = 0; row < BOARD_SIZE; row++) {
    const cells = board[row].map((cell) => {
      if (cell === "B") return "\u25CF"; // black circle
      if (cell === "W") return "\u25CB"; // white circle
      return " ";
    });
    lines.push(`${row + 1} | ${cells.join(" | ")} |`);
    lines.push("  +---+---+---+---+---+---+---+---+");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

interface OthelloActionResult {
  position: string; // e.g. "c4"
  comment?: string;
}

function buildOthelloPrompt(
  state: OthelloGameState,
  playerIndex: number,
): string {
  const player = state.players[playerIndex];
  const opponent = state.players[1 - playerIndex];
  const legalMoves = getLegalMoves(state.board, player.color);

  const movesDescription = legalMoves
    .map((m) => `  ${m.pos} (flips ${m.flips.length} piece${m.flips.length !== 1 ? "s" : ""})`)
    .join("\n");

  const recentMoves = state.moveHistory
    .slice(-10)
    .map((m) => `  ${m.playerName} (${m.color}): ${m.position} [flipped ${m.flippedSquares.length}]${m.comment ? ` - "${m.comment}"` : ""}`)
    .join("\n");

  const counts = countPieces(state.board);

  return `You are playing Othello (Reversi)!

=== YOUR INFO ===
Name: ${player.name}
Your color: ${player.color === "B" ? "Black (\u25CF)" : "White (\u25CB)"}
ELO: ${player.elo}

=== OPPONENT ===
Name: ${opponent.name} ${opponent.avatar}
Color: ${opponent.color === "B" ? "Black (\u25CF)" : "White (\u25CB)"}
ELO: ${opponent.elo}

=== CURRENT BOARD ===
${boardToAscii(state.board)}

=== PIECE COUNT ===
Black (\u25CF): ${counts.black}
White (\u25CB): ${counts.white}

=== MOVE HISTORY (last 10) ===
${recentMoves || "(no moves yet - you're going first!)"}

=== LEGAL MOVES ===
${movesDescription || "(no legal moves - you must pass)"}

Respond with EXACTLY this JSON format, nothing else:
{"position": "<square like c4>", "comment": "<brief in-character trash talk or commentary, max 80 chars>"}

RULES:
- Place your piece on one of the legal squares listed above
- Your piece must sandwich opponent pieces between the new piece and an existing piece of your color
- All sandwiched pieces (horizontal, vertical, diagonal) are flipped to your color
- The player with the most pieces when neither player can move wins
- Think strategically: corners are very valuable, edges are strong
- Have fun with it! Show some personality in your comment`;
}

function parseOthelloResponse(text: string, legalMoves: { pos: string }[]): OthelloActionResult {
  if (legalMoves.length === 0) {
    return { position: "pass", comment: "*no legal moves*" };
  }

  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { position: legalMoves[0].pos, comment: "*fumbles with the piece*" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const position = typeof parsed.position === "string" ? parsed.position.toLowerCase().trim() : "";
    const comment = typeof parsed.comment === "string" ? parsed.comment.slice(0, 80) : undefined;

    if (legalMoves.some((m) => m.pos === position)) {
      return { position, comment };
    }

    // Invalid position; pick the first legal move
    return { position: legalMoves[0].pos, comment: comment ?? "*places piece on wrong square*" };
  } catch {
    return { position: legalMoves[0].pos, comment: "*confused clicking*" };
  }
}

async function getBuiltinAction(
  agent: AgentRecord,
  state: OthelloGameState,
  playerIndex: number,
): Promise<OthelloActionResult> {
  const player = state.players[playerIndex];
  const legalMoves = getLegalMoves(state.board, player.color);

  if (legalMoves.length === 0) {
    return { position: "pass", comment: "*no legal moves, passing*" };
  }

  const prompt = buildOthelloPrompt(state, playerIndex);

  const systemPrompt = agent.personality
    ? `${agent.personality} You are now playing Othello. Be strategic but stay in character. Show your personality!`
    : "You are a competitive Othello player. Play smart and have fun with trash talk.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseOthelloResponse(text, legalMoves);
  } catch (error) {
    console.error(`[Othello] Builtin agent ${agent.name} error:`, error);
    return { position: legalMoves[0].pos, comment: "*connection issues*" };
  }
}

async function getExternalAction(
  agent: AgentRecord,
  state: OthelloGameState,
  playerIndex: number,
): Promise<OthelloActionResult> {
  const player = state.players[playerIndex];
  const legalMoves = getLegalMoves(state.board, player.color);

  if (legalMoves.length === 0) {
    return { position: "pass", comment: "*no legal moves, passing*" };
  }

  const prompt = buildOthelloPrompt(state, playerIndex);

  const payload = {
    game_id: state.id,
    game_type: "othello",
    state: {
      board: state.board,
      your_color: player.color,
      legal_moves: legalMoves.map((m) => ({
        position: m.pos,
        flips: m.flips.length,
      })),
      black_count: state.blackCount,
      white_count: state.whiteCount,
      move_history: state.moveHistory.map(
        (m) => `${m.playerName}(${m.color}):${m.position}[${m.flippedSquares.length}]`,
      ),
    },
    legal_actions: legalMoves.map((m) => m.pos),
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
    return parseOthelloResponse(text, legalMoves);
  } catch (error) {
    console.error(`[Othello] External agent ${agent.name} error:`, error);
    return { position: legalMoves[0].pos, comment: "*timed out*" };
  }
}

async function getOthelloAgentAction(
  agent: AgentRecord,
  state: OthelloGameState,
  playerIndex: number,
): Promise<OthelloActionResult> {
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

/** Run a complete Othello game. Returns the final game state. */
export async function playOthelloGame(playerIds: string[]): Promise<OthelloGameState> {
  if (playerIds.length !== 2) {
    throw new Error("Othello requires exactly 2 players");
  }

  const agents = loadAgents(playerIds);
  const gameId = uuid();
  const db = getDb();

  // Randomly assign Black and White
  const first = Math.random() < 0.5 ? 0 : 1;

  // Create the DB record
  db.prepare(
    "INSERT INTO othello_games (id, status, player_a, player_b, state, scheduled_at, started_at, created_at) VALUES (?, 'live', ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))",
  ).run(gameId, agents[first].id, agents[1 - first].id, "{}");

  const initialBoard = createInitialBoard();
  const initialCounts = countPieces(initialBoard);

  // Initialize state
  const state: OthelloGameState = {
    id: gameId,
    board: initialBoard,
    players: [
      {
        agentId: agents[first].id,
        name: agents[first].name,
        avatar: agents[first].avatar,
        color: "B", // Black goes first
        elo: agents[first].elo,
      },
      {
        agentId: agents[1 - first].id,
        name: agents[1 - first].name,
        avatar: agents[1 - first].avatar,
        color: "W",
        elo: agents[1 - first].elo,
      },
    ],
    currentPlayerIndex: 0, // Black always goes first
    moveHistory: [],
    blackCount: initialCounts.black,
    whiteCount: initialCounts.white,
    lastMove: null,
    winner: null,
    status: "live",
  };

  console.log(`[Othello] Game ${gameId} started! ${state.players[0].name} (Black) vs ${state.players[1].name} (White)`);

  // Broadcast initial state
  liveOthelloGames.set(gameId, deepCopyState(state));

  // Game loop - max 60 moves (64 squares minus 4 starting pieces)
  let consecutivePasses = 0;

  for (let moveNum = 0; moveNum < 60; moveNum++) {
    const playerIndex = state.currentPlayerIndex;
    const player = state.players[playerIndex];
    const agent = agents.find((a) => a.id === player.agentId)!;

    const legalMoves = getLegalMoves(state.board, player.color);

    // Check if player must pass
    if (legalMoves.length === 0) {
      consecutivePasses++;
      console.log(`[Othello] ${player.name} (${player.color}) has no legal moves - passing`);

      const passMove: OthelloMove = {
        playerId: player.agentId,
        playerName: player.name,
        color: player.color,
        position: "pass",
        flippedSquares: [],
        comment: "*no legal moves*",
        moveNumber: moveNum + 1,
      };
      state.moveHistory.push(passMove);
      state.lastMove = { position: "pass", flippedSquares: [] };

      // If both players passed consecutively, game is over
      if (consecutivePasses >= 2) {
        console.log(`[Othello] Both players passed - game over!`);
        break;
      }

      state.currentPlayerIndex = 1 - playerIndex;
      liveOthelloGames.set(gameId, deepCopyState(state));
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    consecutivePasses = 0;

    // Get agent's move
    const result = await getOthelloAgentAction(agent, state, playerIndex);

    // Handle pass (shouldn't happen if there are legal moves, but be safe)
    if (result.position === "pass") {
      state.currentPlayerIndex = 1 - playerIndex;
      continue;
    }

    // Apply the move
    const coords = posToCoords(result.position);
    if (!coords) {
      console.error(`[Othello] Invalid position from ${player.name}: ${result.position}`);
      continue;
    }

    const [row, col] = coords;
    const flips = getFlips(state.board, row, col, player.color);

    // Place the piece
    state.board[row][col] = player.color;

    // Flip sandwiched pieces
    const flippedSquares: string[] = [];
    for (const [fr, fc] of flips) {
      state.board[fr][fc] = player.color;
      flippedSquares.push(coordsToPos(fr, fc));
    }

    // Update counts
    const counts = countPieces(state.board);
    state.blackCount = counts.black;
    state.whiteCount = counts.white;

    // Record the move
    const move: OthelloMove = {
      playerId: player.agentId,
      playerName: player.name,
      color: player.color,
      position: result.position,
      flippedSquares,
      comment: result.comment,
      moveNumber: moveNum + 1,
    };
    state.moveHistory.push(move);
    state.lastMove = { position: result.position, flippedSquares };

    console.log(
      `[Othello] ${player.name} (${player.color}): ${result.position} [flipped ${flippedSquares.length}: ${flippedSquares.join(", ")}]${result.comment ? ` - "${result.comment}"` : ""}`,
    );

    // Update live state for spectators
    liveOthelloGames.set(gameId, deepCopyState(state));

    // Switch player
    state.currentPlayerIndex = 1 - playerIndex;

    // Update DB periodically (every 5 moves)
    if (moveNum % 5 === 4) {
      db.prepare(
        "UPDATE othello_games SET state = ? WHERE id = ?",
      ).run(JSON.stringify(state), gameId);
    }

    // Delay between moves for spectators
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Determine winner by piece count
  const finalCounts = countPieces(state.board);
  state.blackCount = finalCounts.black;
  state.whiteCount = finalCounts.white;

  if (finalCounts.black > finalCounts.white) {
    const blackPlayer = state.players.find((p) => p.color === "B")!;
    state.winner = blackPlayer.agentId;
    console.log(`[Othello] Black (${blackPlayer.name}) wins ${finalCounts.black}-${finalCounts.white}!`);
  } else if (finalCounts.white > finalCounts.black) {
    const whitePlayer = state.players.find((p) => p.color === "W")!;
    state.winner = whitePlayer.agentId;
    console.log(`[Othello] White (${whitePlayer.name}) wins ${finalCounts.white}-${finalCounts.black}!`);
  } else {
    state.winner = "draw";
    console.log(`[Othello] Draw! ${finalCounts.black}-${finalCounts.white}`);
  }

  state.status = "finished";

  // Final state update
  liveOthelloGames.set(gameId, deepCopyState(state));

  // Finish the game
  finishOthelloGame(state, agents, db);

  // Remove from live games after a short delay so spectators can see the result
  setTimeout(() => {
    liveOthelloGames.delete(gameId);
  }, 10_000);

  return state;
}

function finishOthelloGame(
  state: OthelloGameState,
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
    totalMoves: state.moveHistory.filter((m) => m.position !== "pass").length,
    blackCount: state.blackCount,
    whiteCount: state.whiteCount,
    board: boardToAscii(state.board),
  };

  // Update the game record
  db.prepare(
    "UPDATE othello_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?",
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
      distributeWinnings(player.agentId, state.id, "othello", halfPrize);
    }
  } else {
    // Winner
    db.prepare("UPDATE agents SET wins = wins + 1 WHERE id = ?").run(winnerAgent!.id);
    distributeWinnings(winnerAgent!.id, state.id, "othello", PRIZE_POOL);

    // ELO update
    const { winnerDelta, loserDelta } = calculateEloChange(winnerAgent!.elo, loserAgent!.elo);
    db.prepare("UPDATE agents SET elo = elo + ? WHERE id = ?").run(winnerDelta, winnerAgent!.id);
    db.prepare("UPDATE agents SET elo = elo + ? WHERE id = ?").run(loserDelta, loserAgent!.id);

    // Loser
    db.prepare("UPDATE agents SET losses = losses + 1 WHERE id = ?").run(loserAgent!.id);
    recordLoss(loserAgent!.id, state.id, "othello", 0);

    console.log(
      `[Othello] ELO: ${winnerAgent!.name} ${winnerAgent!.elo} -> ${winnerAgent!.elo + winnerDelta}, ` +
      `${loserAgent!.name} ${loserAgent!.elo} -> ${loserAgent!.elo + loserDelta}`,
    );
  }

  // Settle bets
  settleOthelloBets(state.id, state.winner);

  console.log(`[Othello] Game ${state.id} finished.`);
}

function settleOthelloBets(gameId: string, winner: string | null): void {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM bets WHERE game_id = ? AND game_type = 'othello' AND status = 'pending'")
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

function deepCopyState(state: OthelloGameState): OthelloGameState {
  return {
    ...state,
    board: state.board.map((row) => [...row]),
    players: [{ ...state.players[0] }, { ...state.players[1] }],
    moveHistory: [...state.moveHistory],
    lastMove: state.lastMove ? { ...state.lastMove, flippedSquares: [...state.lastMove.flippedSquares] } : null,
  };
}
