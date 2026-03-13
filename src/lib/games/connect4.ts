import { getDb } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import { distributeWinnings, recordLoss } from "@/lib/economics";

// In-memory live state for spectating
const liveConnect4Games = new Map<string, Connect4GameState>();

export function getLiveConnect4Game(id: string): Connect4GameState | undefined {
  return liveConnect4Games.get(id);
}

export function listLiveConnect4Games(): Connect4GameState[] {
  return Array.from(liveConnect4Games.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CellValue = "" | "X" | "O";

export interface Connect4Move {
  playerId: string;
  playerName: string;
  piece: "X" | "O";
  column: number;
  row: number;
  comment?: string;
  moveNumber: number;
}

export interface Connect4Player {
  agentId: string;
  name: string;
  avatar: string;
  piece: "X" | "O";
  elo: number;
}

export interface Connect4GameState {
  id: string;
  board: CellValue[][];       // board[row][col], row 0 = top
  players: [Connect4Player, Connect4Player];
  currentPlayerIndex: number; // 0 or 1
  moveHistory: Connect4Move[];
  winner: string | null;      // agentId or "draw"
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

const ROWS = 6;
const COLS = 7;
const PRIZE_POOL = 400;
const EXTERNAL_TIMEOUT_MS = 15_000;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function createEmptyBoard(): CellValue[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill("") as CellValue[]);
}

function getLegalColumns(board: CellValue[][]): number[] {
  const legal: number[] = [];
  for (let col = 0; col < COLS; col++) {
    if (board[0][col] === "") {
      legal.push(col);
    }
  }
  return legal;
}

/** Drop a piece into a column. Returns the row it landed on, or -1 if column is full. */
function dropPiece(board: CellValue[][], col: number, piece: "X" | "O"): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === "") {
      board[row][col] = piece;
      return row;
    }
  }
  return -1;
}

/** Check if the last move at (row, col) created a 4-in-a-row. */
function checkWin(board: CellValue[][], row: number, col: number): boolean {
  const piece = board[row][col];
  if (!piece) return false;

  const directions = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal down-right
    [1, -1],  // diagonal down-left
  ];

  for (const [dr, dc] of directions) {
    let count = 1;
    // Count in positive direction
    for (let i = 1; i < 4; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== piece) break;
      count++;
    }
    // Count in negative direction
    for (let i = 1; i < 4; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== piece) break;
      count++;
    }
    if (count >= 4) return true;
  }
  return false;
}

function boardIsFull(board: CellValue[][]): boolean {
  return board[0].every((cell) => cell !== "");
}

function boardToAscii(board: CellValue[][]): string {
  const lines: string[] = [];
  lines.push("  0   1   2   3   4   5   6");
  lines.push("+---+---+---+---+---+---+---+");
  for (let row = 0; row < ROWS; row++) {
    const cells = board[row].map((cell) => cell === "" ? " " : cell);
    lines.push("| " + cells.join(" | ") + " |");
    lines.push("+---+---+---+---+---+---+---+");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

interface Connect4ActionResult {
  column: number;
  comment?: string;
}

function buildConnect4Prompt(
  state: Connect4GameState,
  playerIndex: number,
): string {
  const player = state.players[playerIndex];
  const opponent = state.players[1 - playerIndex];
  const legalCols = getLegalColumns(state.board);

  const recentMoves = state.moveHistory
    .slice(-10)
    .map((m) => `  ${m.playerName} (${m.piece}): column ${m.column}${m.comment ? ` - "${m.comment}"` : ""}`)
    .join("\n");

  return `You are playing Connect 4!

=== YOUR INFO ===
Name: ${player.name}
Your piece: ${player.piece}
ELO: ${player.elo}

=== OPPONENT ===
Name: ${opponent.name} ${opponent.avatar}
Piece: ${opponent.piece}
ELO: ${opponent.elo}

=== CURRENT BOARD ===
${boardToAscii(state.board)}

=== MOVE HISTORY ===
${recentMoves || "(no moves yet - you're going first!)"}

=== LEGAL MOVES ===
Columns you can drop into: ${legalCols.join(", ")}

Respond with EXACTLY this JSON format, nothing else:
{"column": <number 0-6>, "comment": "<brief in-character trash talk or commentary, max 80 chars>"}

RULES:
- Drop your piece into one of the legal columns listed above
- First to get 4 in a row (horizontal, vertical, or diagonal) wins
- Think strategically: block your opponent and set up multi-way threats
- Have fun with it! Show some personality in your comment`;
}

function parseConnect4Response(text: string, legalCols: number[]): Connect4ActionResult {
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    // Pick a random legal column as fallback
    return { column: legalCols[Math.floor(Math.random() * legalCols.length)], comment: "*fumbles with the piece*" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const column = typeof parsed.column === "number" ? parsed.column : -1;
    const comment = typeof parsed.comment === "string" ? parsed.comment.slice(0, 80) : undefined;

    if (legalCols.includes(column)) {
      return { column, comment };
    }

    // Invalid column; pick closest legal one
    const closest = legalCols.reduce((best, col) =>
      Math.abs(col - column) < Math.abs(best - column) ? col : best,
    );
    return { column: closest, comment: comment ?? "*drops piece in wrong slot*" };
  } catch {
    return { column: legalCols[Math.floor(Math.random() * legalCols.length)], comment: "*confused clicking*" };
  }
}

async function getBuiltinAction(
  agent: AgentRecord,
  state: Connect4GameState,
  playerIndex: number,
): Promise<Connect4ActionResult> {
  const prompt = buildConnect4Prompt(state, playerIndex);
  const legalCols = getLegalColumns(state.board);

  const systemPrompt = agent.personality
    ? `${agent.personality} You are now playing Connect 4. Be strategic but stay in character. Show your personality!`
    : "You are a competitive Connect 4 player. Play smart and have fun with trash talk.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseConnect4Response(text, legalCols);
  } catch (error) {
    console.error(`[Connect4] Builtin agent ${agent.name} error:`, error);
    return { column: legalCols[Math.floor(Math.random() * legalCols.length)], comment: "*connection issues*" };
  }
}

async function getExternalAction(
  agent: AgentRecord,
  state: Connect4GameState,
  playerIndex: number,
): Promise<Connect4ActionResult> {
  const prompt = buildConnect4Prompt(state, playerIndex);
  const legalCols = getLegalColumns(state.board);

  const payload = {
    game_id: state.id,
    game_type: "connect4",
    state: {
      board: state.board,
      your_piece: state.players[playerIndex].piece,
      legal_columns: legalCols,
      move_history: state.moveHistory.map(
        (m) => `${m.playerName}(${m.piece}):col${m.column}`,
      ),
    },
    legal_actions: legalCols.map((c) => `column ${c}`),
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
    return parseConnect4Response(text, legalCols);
  } catch (error) {
    console.error(`[Connect4] External agent ${agent.name} error:`, error);
    return { column: legalCols[Math.floor(Math.random() * legalCols.length)], comment: "*timed out*" };
  }
}

async function getConnect4AgentAction(
  agent: AgentRecord,
  state: Connect4GameState,
  playerIndex: number,
): Promise<Connect4ActionResult> {
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

/** Run a complete Connect 4 game. Returns the final game state. */
export async function playConnect4Game(playerIds: string[]): Promise<Connect4GameState> {
  if (playerIds.length !== 2) {
    throw new Error("Connect 4 requires exactly 2 players");
  }

  const agents = loadAgents(playerIds);
  const gameId = uuid();
  const db = getDb();

  // Randomly assign X and O
  const first = Math.random() < 0.5 ? 0 : 1;
  const pieces: ["X", "O"] = ["X", "O"];

  // Create the DB record
  db.prepare(
    "INSERT INTO connect4_games (id, status, player_a, player_b, state, scheduled_at, started_at, created_at) VALUES (?, 'live', ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))",
  ).run(gameId, agents[first].id, agents[1 - first].id, "{}");

  // Initialize state
  const state: Connect4GameState = {
    id: gameId,
    board: createEmptyBoard(),
    players: [
      {
        agentId: agents[first].id,
        name: agents[first].name,
        avatar: agents[first].avatar,
        piece: pieces[0],
        elo: agents[first].elo,
      },
      {
        agentId: agents[1 - first].id,
        name: agents[1 - first].name,
        avatar: agents[1 - first].avatar,
        piece: pieces[1],
        elo: agents[1 - first].elo,
      },
    ],
    currentPlayerIndex: 0, // X always goes first
    moveHistory: [],
    winner: null,
    status: "live",
  };

  console.log(`[Connect4] Game ${gameId} started! ${state.players[0].name} (X) vs ${state.players[1].name} (O)`);

  // Broadcast initial state
  liveConnect4Games.set(gameId, deepCopyState(state));

  // Game loop - max 42 moves (6 rows x 7 cols)
  for (let moveNum = 0; moveNum < ROWS * COLS; moveNum++) {
    const playerIndex = state.currentPlayerIndex;
    const player = state.players[playerIndex];
    const agent = agents.find((a) => a.id === player.agentId)!;

    // Get agent's move
    const result = await getConnect4AgentAction(agent, state, playerIndex);

    // Apply the move
    const row = dropPiece(state.board, result.column, player.piece);
    if (row === -1) {
      // This shouldn't happen since we validate legal columns, but just in case
      console.error(`[Connect4] Invalid move by ${player.name}: column ${result.column} is full`);
      continue;
    }

    const move: Connect4Move = {
      playerId: player.agentId,
      playerName: player.name,
      piece: player.piece,
      column: result.column,
      row,
      comment: result.comment,
      moveNumber: moveNum + 1,
    };
    state.moveHistory.push(move);

    console.log(
      `[Connect4] ${player.name} (${player.piece}): column ${result.column}${result.comment ? ` - "${result.comment}"` : ""}`,
    );

    // Update live state for spectators
    liveConnect4Games.set(gameId, deepCopyState(state));

    // Check for win
    if (checkWin(state.board, row, result.column)) {
      state.winner = player.agentId;
      state.status = "finished";
      console.log(`[Connect4] ${player.name} wins with 4 in a row!`);
      break;
    }

    // Check for draw
    if (boardIsFull(state.board)) {
      state.winner = "draw";
      state.status = "finished";
      console.log(`[Connect4] Game is a draw - board is full!`);
      break;
    }

    // Switch player
    state.currentPlayerIndex = 1 - playerIndex;

    // Update DB periodically (every 5 moves)
    if (moveNum % 5 === 4) {
      db.prepare(
        "UPDATE connect4_games SET state = ? WHERE id = ?",
      ).run(JSON.stringify(state), gameId);
    }

    // Delay between moves for spectators
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Final state update
  liveConnect4Games.set(gameId, deepCopyState(state));

  // Finish the game
  finishConnect4Game(state, agents, db);

  // Remove from live games after a short delay so spectators can see the result
  setTimeout(() => {
    liveConnect4Games.delete(gameId);
  }, 10_000);

  return state;
}

function finishConnect4Game(
  state: Connect4GameState,
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
    totalMoves: state.moveHistory.length,
    board: boardToAscii(state.board),
  };

  const resultString = isDraw ? "draw" : winnerAgent!.id;

  // Update the game record
  db.prepare(
    "UPDATE connect4_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?",
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
      distributeWinnings(player.agentId, state.id, "connect4", halfPrize);
    }
  } else {
    // Winner
    db.prepare("UPDATE agents SET wins = wins + 1 WHERE id = ?").run(winnerAgent!.id);
    distributeWinnings(winnerAgent!.id, state.id, "connect4", PRIZE_POOL);

    // ELO update
    const { winnerDelta, loserDelta } = calculateEloChange(winnerAgent!.elo, loserAgent!.elo);
    db.prepare("UPDATE agents SET elo = elo + ? WHERE id = ?").run(winnerDelta, winnerAgent!.id);
    db.prepare("UPDATE agents SET elo = elo + ? WHERE id = ?").run(loserDelta, loserAgent!.id);

    // Loser
    db.prepare("UPDATE agents SET losses = losses + 1 WHERE id = ?").run(loserAgent!.id);
    recordLoss(loserAgent!.id, state.id, "connect4", 0);

    console.log(
      `[Connect4] ELO: ${winnerAgent!.name} ${winnerAgent!.elo} -> ${winnerAgent!.elo + winnerDelta}, ` +
      `${loserAgent!.name} ${loserAgent!.elo} -> ${loserAgent!.elo + loserDelta}`,
    );
  }

  // Settle bets
  settleConnect4Bets(state.id, state.winner);

  console.log(`[Connect4] Game ${state.id} finished.`);
}

function settleConnect4Bets(gameId: string, winner: string | null): void {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM bets WHERE game_id = ? AND game_type = 'connect4' AND status = 'pending'")
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

function deepCopyState(state: Connect4GameState): Connect4GameState {
  return {
    ...state,
    board: state.board.map((row) => [...row]),
    players: [{ ...state.players[0] }, { ...state.players[1] }],
    moveHistory: [...state.moveHistory],
  };
}
