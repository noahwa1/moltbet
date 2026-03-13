import { getDb } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import { distributeWinnings, recordLoss } from "@/lib/economics";

// In-memory live state for spectating
const livePDGames = new Map<string, PDGameState>();

export function getLivePDGame(id: string): PDGameState | undefined {
  return livePDGames.get(id);
}

export function listLivePDGames(): PDGameState[] {
  return Array.from(livePDGames.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PDChoice = "cooperate" | "defect";

export interface PDPlayer {
  agentId: string;
  name: string;
  avatar: string;
  personality: string | null;
  score: number;
}

export interface PDRoundResult {
  round: number;
  choices: { playerA: PDChoice; playerB: PDChoice };
  scores: { playerA: number; playerB: number };
  comments: { playerA?: string; playerB?: string };
}

export interface PDGameState {
  id: string;
  players: [PDPlayer, PDPlayer];
  currentRound: number;
  totalRounds: number;
  roundHistory: PDRoundResult[];
  phase: "choosing" | "reveal" | "finished";
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

interface PDActionResult {
  action: PDChoice;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_ROUNDS = 10;
const PRIZE_POOL = 300;
const EXTERNAL_TIMEOUT_MS = 15_000;

// Payoff matrix
const PAYOFF: Record<PDChoice, Record<PDChoice, [number, number]>> = {
  cooperate: {
    cooperate: [3, 3],
    defect: [0, 5],
  },
  defect: {
    cooperate: [5, 0],
    defect: [1, 1],
  },
};

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

function buildRoundPrompt(
  state: PDGameState,
  playerIndex: 0 | 1,
): string {
  const player = state.players[playerIndex];
  const opponent = state.players[playerIndex === 0 ? 1 : 0];

  const historyLines = state.roundHistory
    .map((r) => {
      const yourChoice = playerIndex === 0 ? r.choices.playerA : r.choices.playerB;
      const theirChoice = playerIndex === 0 ? r.choices.playerB : r.choices.playerA;
      const yourScore = playerIndex === 0 ? r.scores.playerA : r.scores.playerB;
      const theirScore = playerIndex === 0 ? r.scores.playerB : r.scores.playerA;
      const theirComment = playerIndex === 0 ? r.comments.playerB : r.comments.playerA;
      return `  Round ${r.round}: You chose ${yourChoice.toUpperCase()}, ${opponent.name} chose ${theirChoice.toUpperCase()} → You: +${yourScore}, Them: +${theirScore}${theirComment ? ` (${opponent.name} said: "${theirComment}")` : ""}`;
    })
    .join("\n");

  return `You are playing an Iterated Prisoner's Dilemma tournament.

=== YOUR INFO ===
Name: ${player.name}
Your current score: ${player.score}

=== OPPONENT ===
Name: ${opponent.name} ${opponent.avatar}
Their current score: ${opponent.score}
${opponent.personality ? `Personality: ${opponent.personality}` : ""}

=== ROUND ${state.currentRound}/${state.totalRounds} ===

=== PAYOFF MATRIX ===
- Both COOPERATE: +3 points each (mutual benefit)
- Both DEFECT: +1 point each (mutual punishment)
- You COOPERATE, they DEFECT: You get +0, they get +5 (you got exploited)
- You DEFECT, they COOPERATE: You get +5, they get +0 (you exploited them)

=== HISTORY ===
${historyLines || "(No rounds played yet — this is the first round)"}

=== LEGAL ACTIONS ===
cooperate
defect

Respond with EXACTLY this JSON format, nothing else:
{"action": "cooperate" or "defect", "comment": "<brief in-character comment explaining your reasoning, max 80 chars>"}

Think carefully about your strategy. Consider your opponent's past behavior, their personality, and how many rounds remain. Trust, betrayal, and reputation all matter.`;
}

function parseAgentResponse(text: string): PDActionResult {
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { action: "cooperate", comment: "*couldn't decide, defaulting to cooperation*" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const action = parsed.action as string;
    const comment = typeof parsed.comment === "string" ? parsed.comment.slice(0, 80) : undefined;

    if (action === "cooperate" || action === "defect") {
      return { action, comment };
    }

    // Try to interpret partial matches
    if (action?.toLowerCase().startsWith("coop")) {
      return { action: "cooperate", comment };
    }
    if (action?.toLowerCase().startsWith("def")) {
      return { action: "defect", comment };
    }

    return { action: "cooperate", comment: comment ?? "*confused, choosing peace*" };
  } catch {
    return { action: "cooperate", comment: "*error parsing action*" };
  }
}

async function getBuiltinAction(
  agent: AgentRecord,
  prompt: string,
): Promise<PDActionResult> {
  const systemPrompt = agent.personality
    ? `${agent.personality} You are now playing a Prisoner's Dilemma tournament. Stay in character and play strategically.`
    : "You are a strategic game theory player. Play the Prisoner's Dilemma intelligently.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseAgentResponse(text);
  } catch (error) {
    console.error(`[PD] Builtin agent ${agent.name} error:`, error);
    return { action: "cooperate", comment: "*connection issues*" };
  }
}

async function getExternalAction(
  agent: AgentRecord,
  state: PDGameState,
  playerIndex: 0 | 1,
  prompt: string,
): Promise<PDActionResult> {
  const player = state.players[playerIndex];
  const opponent = state.players[playerIndex === 0 ? 1 : 0];

  const payload = {
    game_id: state.id,
    game_type: "prisoners-dilemma",
    state: {
      current_round: state.currentRound,
      total_rounds: state.totalRounds,
      your_score: player.score,
      opponent_score: opponent.score,
      opponent_name: opponent.name,
      round_history: state.roundHistory.map((r) => ({
        round: r.round,
        your_choice: playerIndex === 0 ? r.choices.playerA : r.choices.playerB,
        their_choice: playerIndex === 0 ? r.choices.playerB : r.choices.playerA,
      })),
    },
    legal_actions: ["cooperate", "defect"],
    action_history: state.roundHistory.map((r) => {
      const yourChoice = playerIndex === 0 ? r.choices.playerA : r.choices.playerB;
      const theirChoice = playerIndex === 0 ? r.choices.playerB : r.choices.playerA;
      return `round${r.round}:you=${yourChoice}:them=${theirChoice}`;
    }),
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
    return parseAgentResponse(text);
  } catch (error) {
    console.error(`[PD] External agent ${agent.name} error:`, error);
    return { action: "cooperate", comment: "*timed out*" };
  }
}

async function getPDAgentAction(
  agent: AgentRecord,
  state: PDGameState,
  playerIndex: 0 | 1,
): Promise<PDActionResult> {
  const prompt = buildRoundPrompt(state, playerIndex);

  if (agent.type === "external" && agent.endpoint) {
    return getExternalAction(agent, state, playerIndex, prompt);
  }
  return getBuiltinAction(agent, prompt);
}

// ---------------------------------------------------------------------------
// Game engine
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

/** Run a complete Prisoner's Dilemma game. Returns the final game state. */
export async function playPrisonersDilemmaGame(
  playerIds: string[],
): Promise<PDGameState> {
  if (playerIds.length !== 2) {
    throw new Error("Prisoner's Dilemma requires exactly 2 players");
  }

  const agents = loadAgents(playerIds);
  const gameId = uuid();
  const db = getDb();

  // Create the DB record
  db.prepare(
    "INSERT INTO prisoners_dilemma_games (id, status, players, started_at, created_at) VALUES (?, 'live', ?, datetime('now'), datetime('now'))"
  ).run(gameId, JSON.stringify(playerIds));

  // Initialize state
  const state: PDGameState = {
    id: gameId,
    players: [
      {
        agentId: agents[0].id,
        name: agents[0].name,
        avatar: agents[0].avatar,
        personality: agents[0].personality,
        score: 0,
      },
      {
        agentId: agents[1].id,
        name: agents[1].name,
        avatar: agents[1].avatar,
        personality: agents[1].personality,
        score: 0,
      },
    ],
    currentRound: 1,
    totalRounds: TOTAL_ROUNDS,
    roundHistory: [],
    phase: "choosing",
  };

  console.log(
    `[PD] Game ${gameId} started: ${agents[0].name} vs ${agents[1].name}`
  );

  // Broadcast initial state
  livePDGames.set(gameId, structuredClone(state));

  // Play each round
  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    state.currentRound = round;
    state.phase = "choosing";
    livePDGames.set(gameId, structuredClone(state));

    // Delay so spectators can see "choosing" phase
    await new Promise((r) => setTimeout(r, 2000));

    // Both players choose simultaneously
    const [actionA, actionB] = await Promise.all([
      getPDAgentAction(agents[0], state, 0),
      getPDAgentAction(agents[1], state, 1),
    ]);

    // Calculate payoffs
    const [scoreA, scoreB] = PAYOFF[actionA.action][actionB.action];

    const roundResult: PDRoundResult = {
      round,
      choices: { playerA: actionA.action, playerB: actionB.action },
      scores: { playerA: scoreA, playerB: scoreB },
      comments: { playerA: actionA.comment, playerB: actionB.comment },
    };

    state.roundHistory.push(roundResult);
    state.players[0].score += scoreA;
    state.players[1].score += scoreB;

    // Dramatic reveal phase
    state.phase = "reveal";
    livePDGames.set(gameId, structuredClone(state));

    console.log(
      `[PD] Round ${round}/${TOTAL_ROUNDS}: ${agents[0].name} ${actionA.action.toUpperCase()}${actionA.comment ? ` ("${actionA.comment}")` : ""} vs ${agents[1].name} ${actionB.action.toUpperCase()}${actionB.comment ? ` ("${actionB.comment}")` : ""} → ${scoreA}-${scoreB} (Total: ${state.players[0].score}-${state.players[1].score})`
    );

    // Delay so spectators can see the reveal
    await new Promise((r) => setTimeout(r, 4000));
  }

  // Game finished
  state.phase = "finished";
  livePDGames.set(gameId, structuredClone(state));

  const result = finishGame(state, agents, db);
  livePDGames.delete(gameId);
  return result;
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

function finishGame(
  state: PDGameState,
  agents: AgentRecord[],
  db: ReturnType<typeof getDb>,
): PDGameState {
  const scoreA = state.players[0].score;
  const scoreB = state.players[1].score;

  let winnerId: string | null = null;
  let loserId: string | null = null;
  let isDraw = false;

  if (scoreA > scoreB) {
    winnerId = state.players[0].agentId;
    loserId = state.players[1].agentId;
  } else if (scoreB > scoreA) {
    winnerId = state.players[1].agentId;
    loserId = state.players[0].agentId;
  } else {
    isDraw = true;
  }

  // Build result summary
  const resultSummary = {
    winner: winnerId
      ? {
          agentId: winnerId,
          name: state.players.find((p) => p.agentId === winnerId)?.name,
          score: winnerId === state.players[0].agentId ? scoreA : scoreB,
        }
      : null,
    isDraw,
    finalScores: {
      [state.players[0].agentId]: scoreA,
      [state.players[1].agentId]: scoreB,
    },
    totalRounds: TOTAL_ROUNDS,
    cooperationRates: {
      [state.players[0].agentId]:
        state.roundHistory.filter((r) => r.choices.playerA === "cooperate").length /
        TOTAL_ROUNDS,
      [state.players[1].agentId]:
        state.roundHistory.filter((r) => r.choices.playerB === "cooperate").length /
        TOTAL_ROUNDS,
    },
  };

  // Update DB
  db.prepare(
    "UPDATE prisoners_dilemma_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(state), JSON.stringify(resultSummary), state.id);

  // Update agent stats and economics
  if (isDraw) {
    // Draw: split prize pool, update draws
    const halfPrize = Math.floor(PRIZE_POOL / 2);
    for (const player of state.players) {
      db.prepare(
        "UPDATE agents SET games_played = games_played + 1, draws = draws + 1 WHERE id = ?"
      ).run(player.agentId);
      distributeWinnings(player.agentId, state.id, "prisoners-dilemma", halfPrize);
    }
    console.log(
      `[PD] Game ${state.id} ended in a draw! ${state.players[0].name} (${scoreA}) vs ${state.players[1].name} (${scoreB})`
    );
  } else {
    // Winner
    db.prepare(
      "UPDATE agents SET games_played = games_played + 1, wins = wins + 1 WHERE id = ?"
    ).run(winnerId!);
    distributeWinnings(winnerId!, state.id, "prisoners-dilemma", PRIZE_POOL);

    // Loser
    db.prepare(
      "UPDATE agents SET games_played = games_played + 1, losses = losses + 1 WHERE id = ?"
    ).run(loserId!);
    recordLoss(loserId!, state.id, "prisoners-dilemma", 0);

    const winner = state.players.find((p) => p.agentId === winnerId)!;
    const loser = state.players.find((p) => p.agentId === loserId)!;
    console.log(
      `[PD] Game ${state.id} finished. Winner: ${winner.name} (${winner.score}) over ${loser.name} (${loser.score})`
    );
  }

  // Settle bets
  settlePDBets(state.id, winnerId, isDraw);

  return state;
}

function settlePDBets(
  gameId: string,
  winnerId: string | null,
  isDraw: boolean,
): void {
  const db = getDb();
  const bets = db
    .prepare(
      "SELECT * FROM bets WHERE game_id = ? AND game_type = 'prisoners-dilemma' AND status = 'pending'"
    )
    .all(gameId) as Array<{
    id: string;
    user_id: string;
    agent_id: string;
    amount: number;
    odds: number;
  }>;

  for (const bet of bets) {
    if (isDraw) {
      // Refund on draw
      db.prepare("UPDATE bets SET status = 'refunded', payout = ? WHERE id = ?").run(
        bet.amount,
        bet.id,
      );
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(
        bet.amount,
        bet.user_id,
      );
    } else if (bet.agent_id === winnerId) {
      const payout = Math.round(bet.amount * bet.odds);
      db.prepare("UPDATE bets SET status = 'won', payout = ? WHERE id = ?").run(
        payout,
        bet.id,
      );
      db.prepare(
        "UPDATE users SET balance = balance + ?, total_won = total_won + ? WHERE id = ?"
      ).run(payout, payout, bet.user_id);
    } else {
      db.prepare("UPDATE bets SET status = 'lost', payout = 0 WHERE id = ?").run(
        bet.id,
      );
      db.prepare("UPDATE users SET total_lost = total_lost + ? WHERE id = ?").run(
        bet.amount,
        bet.user_id,
      );
    }
  }
}
