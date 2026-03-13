import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import type { MatchResult } from "./types";

// In-memory live state for spectating
const liveBattlegroundGames = new Map<string, BattlegroundState>();

export function getLiveBattlegroundGame(id: string): BattlegroundState | undefined {
  return liveBattlegroundGames.get(id);
}

export function listLiveBattlegroundGames(): BattlegroundState[] {
  return Array.from(liveBattlegroundGames.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CellState {
  owner: "neutral" | "teamA" | "teamB";
  strength: number; // 1-3
}

export interface TeamInfo {
  id: string;
  name: string;
  agents: { id: string; name: string; avatar: string }[];
  cellCount: number;
}

export interface BattleAction {
  agentId: string;
  agentName: string;
  from: [number, number];
  to: [number, number];
  success: boolean;
  comment?: string;
  turn: number;
}

export interface BattlegroundState {
  id: string;
  grid: CellState[][]; // 8x8
  teamA: TeamInfo;
  teamB: TeamInfo;
  currentTurn: number;
  maxTurns: number;
  phase: "playing" | "finished";
  actions: BattleAction[];
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

const GRID_SIZE = 8;
const MAX_TURNS = 20;
const EXTERNAL_TIMEOUT_MS = 10_000;

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

function createInitialGrid(): CellState[][] {
  const grid: CellState[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: CellState[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push({ owner: "neutral", strength: 0 });
    }
    grid.push(row);
  }

  // Team A starts at top-left region
  grid[0][0] = { owner: "teamA", strength: 2 };
  grid[0][1] = { owner: "teamA", strength: 1 };
  grid[1][0] = { owner: "teamA", strength: 1 };

  // Team B starts at bottom-right region
  grid[7][7] = { owner: "teamB", strength: 2 };
  grid[7][6] = { owner: "teamB", strength: 1 };
  grid[6][7] = { owner: "teamB", strength: 1 };

  return grid;
}

function countCells(grid: CellState[][], owner: "teamA" | "teamB"): number {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.owner === owner) count++;
    }
  }
  return count;
}

function getAdjacentCoords(r: number, c: number): [number, number][] {
  const dirs: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const results: [number, number][] = [];
  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
      results.push([nr, nc]);
    }
  }
  return results;
}

function countFriendlyNeighbors(
  grid: CellState[][],
  r: number,
  c: number,
  team: "teamA" | "teamB"
): number {
  let count = 0;
  for (const [nr, nc] of getAdjacentCoords(r, c)) {
    if (grid[nr][nc].owner === team) count++;
  }
  return count;
}

/**
 * Enumerate all legal attack moves for a team.
 * A legal move: pick a friendly cell, attack an adjacent cell not owned by the team.
 */
function getLegalMoves(
  grid: CellState[][],
  team: "teamA" | "teamB"
): { from: [number, number]; to: [number, number] }[] {
  const moves: { from: [number, number]; to: [number, number] }[] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c].owner !== team) continue;
      for (const [nr, nc] of getAdjacentCoords(r, c)) {
        if (grid[nr][nc].owner !== team) {
          moves.push({ from: [r, c], to: [nr, nc] });
        }
      }
    }
  }
  return moves;
}

/**
 * Resolve an attack. Returns true if the attacker captures the cell.
 *
 * Base probability: 50%
 * +10% for each additional friendly neighbor of the TARGET cell (besides the attacker)
 * +10% if attacker cell strength >= 2
 * -15% if target is enemy (not neutral) with strength >= 2
 */
function resolveAttack(
  grid: CellState[][],
  from: [number, number],
  to: [number, number],
  attackerTeam: "teamA" | "teamB"
): boolean {
  const [tr, tc] = to;
  const targetCell = grid[tr][tc];

  let probability = 0.5;

  // Friendly neighbors of the target cell (excluding the source cell)
  const friendlyNeighborsOfTarget = getAdjacentCoords(tr, tc).filter(
    ([nr, nc]) =>
      grid[nr][nc].owner === attackerTeam &&
      !(nr === from[0] && nc === from[1])
  ).length;
  probability += friendlyNeighborsOfTarget * 0.1;

  // Attacker strength bonus
  if (grid[from[0]][from[1]].strength >= 2) {
    probability += 0.1;
  }

  // Defender strength penalty
  if (
    targetCell.owner !== "neutral" &&
    targetCell.owner !== attackerTeam &&
    targetCell.strength >= 2
  ) {
    probability -= 0.15;
  }

  probability = Math.max(0.1, Math.min(0.95, probability));
  return Math.random() < probability;
}

/**
 * Apply a successful attack: flip the cell and set its strength.
 */
function applyCapture(
  grid: CellState[][],
  to: [number, number],
  newOwner: "teamA" | "teamB"
): void {
  grid[to[0]][to[1]] = { owner: newOwner, strength: 1 };

  // Boost strength of cells that now have more friendly neighbors
  for (const [nr, nc] of getAdjacentCoords(to[0], to[1])) {
    if (grid[nr][nc].owner === newOwner) {
      const friendlyCount = countFriendlyNeighbors(grid, nr, nc, newOwner);
      grid[nr][nc].strength = Math.min(3, Math.max(grid[nr][nc].strength, friendlyCount));
    }
  }
}

// ---------------------------------------------------------------------------
// Grid rendering for prompts
// ---------------------------------------------------------------------------

function renderGrid(grid: CellState[][]): string {
  const lines: string[] = [];
  lines.push("  0 1 2 3 4 5 6 7");
  for (let r = 0; r < GRID_SIZE; r++) {
    let row = `${r} `;
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = grid[r][c];
      if (cell.owner === "teamA") {
        row += cell.strength > 1 ? "A " : "a ";
      } else if (cell.owner === "teamB") {
        row += cell.strength > 1 ? "B " : "b ";
      } else {
        row += ". ";
      }
    }
    lines.push(row.trimEnd());
  }
  lines.push("");
  lines.push("Legend: A/a = Team A (uppercase = strong), B/b = Team B (uppercase = strong), . = neutral");
  return lines.join("\n");
}

function formatMoveList(
  moves: { from: [number, number]; to: [number, number] }[]
): string {
  return moves
    .map(
      (m, i) => `${i}: attack from (${m.from[0]},${m.from[1]}) to (${m.to[0]},${m.to[1]})`
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

function buildPrompt(
  grid: CellState[][],
  team: "teamA" | "teamB",
  agentName: string,
  personality: string | null,
  teammates: string[],
  opponents: string[],
  legalMoves: { from: [number, number]; to: [number, number] }[],
  turn: number,
  maxTurns: number,
  actionHistory: BattleAction[]
): string {
  const teamLabel = team === "teamA" ? "Team A" : "Team B";
  const enemyLabel = team === "teamA" ? "Team B" : "Team A";
  const teamACells = countCells(grid, "teamA");
  const teamBCells = countCells(grid, "teamB");

  const recentActions = actionHistory.slice(-6);
  const historyStr =
    recentActions.length > 0
      ? recentActions
          .map(
            (a) =>
              `Turn ${a.turn}: ${a.agentName} attacked (${a.from[0]},${a.from[1]})->(${a.to[0]},${a.to[1]}) - ${a.success ? "CAPTURED" : "FAILED"}`
          )
          .join("\n")
      : "No actions yet.";

  return `You are "${agentName}" playing Battleground, a territory control game.${personality ? " " + personality : ""}

You are on ${teamLabel}. Your teammates: ${teammates.join(", ") || "none"}. Opponents (${enemyLabel}): ${opponents.join(", ")}.

RULES:
- 8x8 grid. Teams capture territory by attacking adjacent cells.
- Each turn you choose one of your team's cells and attack an adjacent non-friendly cell.
- Attacks are probabilistic: more friendly neighbors around the target = higher success chance.
- Game lasts ${maxTurns} turns total. Team with most cells wins.

CURRENT STATE (Turn ${turn}/${maxTurns}):
Team A cells: ${teamACells} | Team B cells: ${teamBCells} | Neutral: ${64 - teamACells - teamBCells}

${renderGrid(grid)}

RECENT HISTORY:
${historyStr}

YOUR LEGAL MOVES:
${formatMoveList(legalMoves)}

Respond with EXACTLY this JSON format, nothing else:
{"move": <index of your chosen move from the list above>, "comment": "<brief in-character comment, max 80 chars>"}

Pick the move index (0-${legalMoves.length - 1}) that best advances your team's position.`;
}

interface AgentMoveResult {
  moveIndex: number;
  comment: string;
}

async function getBuiltinAgentMove(
  agent: AgentRecord,
  prompt: string,
  legalMovesCount: number
): Promise<AgentMoveResult> {
  try {
    const response = await client.messages.create({
      model: agent.model || "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      return {
        moveIndex: Math.floor(Math.random() * legalMovesCount),
        comment: "*surveys the battlefield*",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    let moveIndex = typeof parsed.move === "number" ? parsed.move : parseInt(parsed.move, 10);

    if (isNaN(moveIndex) || moveIndex < 0 || moveIndex >= legalMovesCount) {
      moveIndex = Math.floor(Math.random() * legalMovesCount);
    }

    return {
      moveIndex,
      comment: parsed.comment || "",
    };
  } catch (error) {
    console.error(
      `[Battleground] Builtin agent ${agent.name} error:`,
      error instanceof Error ? error.message : error
    );
    return {
      moveIndex: Math.floor(Math.random() * legalMovesCount),
      comment: `*communication disrupted* (${error instanceof Error ? error.message : "unknown error"})`,
    };
  }
}

async function getExternalAgentMove(
  agent: AgentRecord,
  prompt: string,
  legalMoves: { from: [number, number]; to: [number, number] }[]
): Promise<AgentMoveResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (agent.api_key) {
      headers["Authorization"] = `Bearer ${agent.api_key}`;
    }

    const payload = {
      game_type: "battleground",
      prompt,
      legal_moves: legalMoves.map((m, i) => ({
        index: i,
        from: m.from,
        to: m.to,
      })),
      time_limit_ms: EXTERNAL_TIMEOUT_MS,
    };

    const res = await fetch(agent.endpoint!, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    let moveIndex =
      typeof data.move === "number" ? data.move : parseInt(data.move, 10);

    if (isNaN(moveIndex) || moveIndex < 0 || moveIndex >= legalMoves.length) {
      moveIndex = Math.floor(Math.random() * legalMoves.length);
    }

    return {
      moveIndex,
      comment: data.comment || "",
    };
  } catch (error) {
    const isTimeout =
      error instanceof DOMException && error.name === "AbortError";
    console.error(
      `[Battleground] External agent ${agent.name} ${isTimeout ? "timeout" : "error"}:`,
      error
    );
    return {
      moveIndex: Math.floor(Math.random() * legalMoves.length),
      comment: isTimeout ? "*timed out - random attack*" : "*connection error - random attack*",
    };
  }
}

async function getAgentAction(
  agent: AgentRecord,
  prompt: string,
  legalMoves: { from: [number, number]; to: [number, number] }[]
): Promise<AgentMoveResult> {
  if (agent.type === "external" && agent.endpoint) {
    return getExternalAgentMove(agent, prompt, legalMoves);
  }
  return getBuiltinAgentMove(agent, prompt, legalMoves.length);
}

// ---------------------------------------------------------------------------
// Main game loop
// ---------------------------------------------------------------------------

function loadAgents(agentIds: string[]): AgentRecord[] {
  const db = getDb();
  return agentIds.map((id) => {
    const row = db
      .prepare(
        "SELECT id, name, type, model, personality, endpoint, api_key, avatar, elo FROM agents WHERE id = ?"
      )
      .get(id) as AgentRecord | undefined;
    if (!row) throw new Error(`Agent not found: ${id}`);
    return row;
  });
}

export async function playBattlegroundGame(
  teamAAgentIds: string[],
  teamBAgentIds: string[],
  onAction?: (state: BattlegroundState) => void
): Promise<{ state: BattlegroundState; result: MatchResult }> {
  if (teamAAgentIds.length < 2 || teamAAgentIds.length > 3) {
    throw new Error("Team A must have 2-3 agents");
  }
  if (teamBAgentIds.length < 2 || teamBAgentIds.length > 3) {
    throw new Error("Team B must have 2-3 agents");
  }

  const teamAAgents = loadAgents(teamAAgentIds);
  const teamBAgents = loadAgents(teamBAgentIds);

  const gameId = uuid();
  const grid = createInitialGrid();
  const actions: BattleAction[] = [];

  const teamA: TeamInfo = {
    id: uuid(),
    name: "Team A",
    agents: teamAAgents.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar })),
    cellCount: countCells(grid, "teamA"),
  };

  const teamB: TeamInfo = {
    id: uuid(),
    name: "Team B",
    agents: teamBAgents.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar })),
    cellCount: countCells(grid, "teamB"),
  };

  const state: BattlegroundState = {
    id: gameId,
    grid,
    teamA,
    teamB,
    currentTurn: 0,
    maxTurns: MAX_TURNS,
    phase: "playing",
    actions,
  };

  // Persist initial state to DB
  const db = getDb();
  db.prepare(
    "INSERT INTO battleground_games (id, status, team_a, team_b, state, turns, scheduled_at, started_at) VALUES (?, 'live', ?, ?, ?, '[]', datetime('now'), datetime('now'))"
  ).run(
    gameId,
    JSON.stringify(teamAAgentIds),
    JSON.stringify(teamBAgentIds),
    JSON.stringify(state)
  );

  // Broadcast initial live state
  liveBattlegroundGames.set(gameId, { ...state, grid: state.grid.map(r => r.map(c => ({ ...c }))), actions: [] });

  // Build a round-robin turn order: alternate teams, cycle through agents
  // Each turn, one agent from each team acts (but we alternate so it's fair)
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    state.currentTurn = turn;

    // Determine which team goes and which agent within that team
    const isTeamATurn = turn % 2 === 1;
    const currentTeam = isTeamATurn ? "teamA" : "teamB";
    const currentAgents = isTeamATurn ? teamAAgents : teamBAgents;
    const agent = currentAgents[(Math.floor((turn - 1) / 2)) % currentAgents.length];

    const teammates = (isTeamATurn ? teamAAgents : teamBAgents)
      .filter((a) => a.id !== agent.id)
      .map((a) => a.name);
    const opponents = (isTeamATurn ? teamBAgents : teamAAgents).map(
      (a) => a.name
    );

    const legalMoves = getLegalMoves(grid, currentTeam);
    if (legalMoves.length === 0) {
      // No legal moves (all cells surrounded by friendlies or team wiped) - skip
      continue;
    }

    const prompt = buildPrompt(
      grid,
      currentTeam,
      agent.name,
      agent.personality,
      teammates,
      opponents,
      legalMoves,
      turn,
      MAX_TURNS,
      actions
    );

    const result = await getAgentAction(agent, prompt, legalMoves);
    const chosenMove = legalMoves[result.moveIndex];

    const attackSuccess = resolveAttack(grid, chosenMove.from, chosenMove.to, currentTeam);

    if (attackSuccess) {
      applyCapture(grid, chosenMove.to, currentTeam);
    }

    const action: BattleAction = {
      agentId: agent.id,
      agentName: agent.name,
      from: chosenMove.from,
      to: chosenMove.to,
      success: attackSuccess,
      comment: result.comment,
      turn,
    };
    actions.push(action);

    // Update cell counts
    state.teamA.cellCount = countCells(grid, "teamA");
    state.teamB.cellCount = countCells(grid, "teamB");

    // Persist periodically
    if (turn % 4 === 0) {
      db.prepare(
        "UPDATE battleground_games SET state = ?, turns = ? WHERE id = ?"
      ).run(JSON.stringify(state), JSON.stringify(actions), gameId);
    }

    // Broadcast live state for spectating
    liveBattlegroundGames.set(gameId, {
      ...state,
      grid: state.grid.map(r => r.map(c => ({ ...c }))),
      actions: [...actions],
    });

    if (onAction) onAction({ ...state, actions: [...actions] });

    // Pace the game for spectators
    await new Promise((r) => setTimeout(r, 3000));

    // Early termination: if one team has zero cells, game over
    if (state.teamA.cellCount === 0 || state.teamB.cellCount === 0) {
      break;
    }
  }

  // ---------------------------------------------------------------------------
  // Determine winner
  // ---------------------------------------------------------------------------

  state.phase = "finished";
  state.teamA.cellCount = countCells(grid, "teamA");
  state.teamB.cellCount = countCells(grid, "teamB");

  let winningTeam: "teamA" | "teamB" | "draw";
  if (state.teamA.cellCount > state.teamB.cellCount) {
    winningTeam = "teamA";
  } else if (state.teamB.cellCount > state.teamA.cellCount) {
    winningTeam = "teamB";
  } else {
    winningTeam = "draw";
  }

  const summary = `${winningTeam === "draw" ? "Draw" : winningTeam === "teamA" ? "Team A wins" : "Team B wins"}! Final score: Team A ${state.teamA.cellCount} - Team B ${state.teamB.cellCount} (${actions.length} actions played)`;

  // Build MatchResult
  const placements: Record<string, number> = {};
  const scores: Record<string, number> = {};

  for (const a of teamAAgents) {
    placements[a.id] = winningTeam === "teamA" ? 1 : winningTeam === "draw" ? 1 : 2;
    scores[a.id] = state.teamA.cellCount;
  }
  for (const a of teamBAgents) {
    placements[a.id] = winningTeam === "teamB" ? 1 : winningTeam === "draw" ? 1 : 2;
    scores[a.id] = state.teamB.cellCount;
  }

  const matchResult: MatchResult = { placements, scores, summary };

  // Persist final state
  db.prepare(
    "UPDATE battleground_games SET status = 'finished', state = ?, turns = ?, result = ?, finished_at = datetime('now') WHERE id = ?"
  ).run(
    JSON.stringify(state),
    JSON.stringify(actions),
    JSON.stringify(matchResult),
    gameId
  );

  // Update agent stats
  const allWinners = winningTeam === "teamA" ? teamAAgents : winningTeam === "teamB" ? teamBAgents : [];
  const allLosers = winningTeam === "teamA" ? teamBAgents : winningTeam === "teamB" ? teamAAgents : [];

  for (const agent of allWinners) {
    db.prepare(
      "UPDATE agents SET wins = wins + 1, games_played = games_played + 1 WHERE id = ?"
    ).run(agent.id);
  }
  for (const agent of allLosers) {
    db.prepare(
      "UPDATE agents SET losses = losses + 1, games_played = games_played + 1 WHERE id = ?"
    ).run(agent.id);
  }
  if (winningTeam === "draw") {
    for (const agent of [...teamAAgents, ...teamBAgents]) {
      db.prepare(
        "UPDATE agents SET draws = draws + 1, games_played = games_played + 1 WHERE id = ?"
      ).run(agent.id);
    }
  }

  // Settle battleground bets
  settleBattlegroundBets(gameId, winningTeam, teamAAgentIds, teamBAgentIds);

  // Clean up live state
  liveBattlegroundGames.delete(gameId);

  return { state, result: matchResult };
}

// ---------------------------------------------------------------------------
// Bet settlement
// ---------------------------------------------------------------------------

function settleBattlegroundBets(
  gameId: string,
  winningTeam: "teamA" | "teamB" | "draw",
  teamAAgentIds: string[],
  teamBAgentIds: string[]
): void {
  const db = getDb();
  const bets = db
    .prepare(
      "SELECT * FROM bets WHERE game_id = ? AND game_type = 'battleground' AND status = 'pending'"
    )
    .all(gameId) as Array<{
    id: string;
    user_id: string;
    agent_id: string | null;
    team_id: string | null;
    amount: number;
    odds: number;
  }>;

  for (const bet of bets) {
    let won = false;

    if (bet.agent_id) {
      // Bet was on a specific agent - check if that agent's team won
      if (
        winningTeam === "teamA" &&
        teamAAgentIds.includes(bet.agent_id)
      ) {
        won = true;
      } else if (
        winningTeam === "teamB" &&
        teamBAgentIds.includes(bet.agent_id)
      ) {
        won = true;
      }
    }

    if (won) {
      const payout = Math.round(bet.amount * bet.odds);
      db.prepare("UPDATE bets SET status = 'won', payout = ? WHERE id = ?").run(
        payout,
        bet.id
      );
      db.prepare(
        "UPDATE users SET balance = balance + ?, total_won = total_won + ? WHERE id = ?"
      ).run(payout, payout, bet.user_id);
    } else {
      db.prepare("UPDATE bets SET status = 'lost', payout = 0 WHERE id = ?").run(
        bet.id
      );
      db.prepare(
        "UPDATE users SET total_lost = total_lost + ? WHERE id = ?"
      ).run(bet.amount, bet.user_id);
    }
  }
}
