import { getDb } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import { distributeWinnings, recordLoss } from "@/lib/economics";

// In-memory live state for spectating
const liveDebateGames = new Map<string, DebateGameState>();

export function getLiveDebateGame(id: string): DebateGameState | undefined {
  return liveDebateGames.get(id);
}

export function listLiveDebateGames(): DebateGameState[] {
  return Array.from(liveDebateGames.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebateSpeech {
  agentId: string;
  agentName: string;
  round: "opening" | "rebuttal" | "closing";
  side: string;
  text: string;
}

export interface DebateScores {
  [agentId: string]: {
    argumentQuality: number;
    rhetoric: number;
    rebuttals: number;
    persuasiveness: number;
    total: number;
  };
}

export interface DebateGameState {
  id: string;
  topic: string;
  sides: { [agentId: string]: string };
  round: "opening" | "rebuttal" | "closing" | "judging" | "finished";
  speeches: DebateSpeech[];
  scores: DebateScores | null;
  winner: string | null; // agentId or "draw"
  players: Array<{
    agentId: string;
    name: string;
    avatar: string;
  }>;
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

const DEBATE_TOPICS = [
  "Cats vs Dogs: which is the superior pet?",
  "Is a hot dog a sandwich?",
  "Would you rather fight 100 duck-sized horses or 1 horse-sized duck?",
  "Pineapple on pizza: culinary genius or abomination?",
  "Morning people vs night owls: who runs the world?",
  "Is water wet?",
  "Tabs vs spaces: the only correct answer",
  "Is cereal a soup?",
  "Teleportation vs time travel: which superpower reigns supreme?",
  "Pirates vs ninjas: who wins in a fight?",
  "Is math discovered or invented?",
  "Socks with sandals: fashion crime or power move?",
  "Would you rather always be 10 minutes late or 20 minutes early?",
  "Is a taco a sandwich?",
  "Batman vs Superman: who is the better hero?",
  "Should toilet paper hang over or under?",
  "Are pancakes better than waffles?",
  "Is it acceptable to recline your seat on an airplane?",
  "Robots vs zombies: who would win the apocalypse?",
  "Is GIF pronounced with a hard G or soft G?",
  "Invisibility vs flight: the ultimate superpower debate",
  "Books vs movies: which tells a better story?",
  "Is a straw one hole or two holes?",
  "Should you put milk before or after cereal?",
  "Are hot dogs better than hamburgers?",
];

const ROUNDS: Array<"opening" | "rebuttal" | "closing"> = [
  "opening",
  "rebuttal",
  "closing",
];

const ROUND_NAMES: Record<string, string> = {
  opening: "Opening Statement",
  rebuttal: "Rebuttal",
  closing: "Closing Argument",
};

const PRIZE_POOL = 400;
const EXTERNAL_TIMEOUT_MS = 15_000;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Topic and side assignment
// ---------------------------------------------------------------------------

function pickTopic(): { topic: string; sideA: string; sideB: string } {
  const topic = DEBATE_TOPICS[Math.floor(Math.random() * DEBATE_TOPICS.length)];

  // Extract two sides from the topic
  const vsMatch = topic.match(/^(.+?)\s+vs\.?\s+(.+?)[:?]/i);
  if (vsMatch) {
    return { topic, sideA: vsMatch[1].trim(), sideB: vsMatch[2].trim() };
  }

  const colonMatch = topic.match(/^(.+?)[:?]\s*(.+)$/);
  if (colonMatch) {
    return { topic, sideA: "For", sideB: "Against" };
  }

  // Fallback for yes/no style topics
  return { topic, sideA: "For", sideB: "Against" };
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

function buildDebatePrompt(
  agent: AgentRecord,
  state: DebateGameState,
  round: "opening" | "rebuttal" | "closing",
): string {
  const side = state.sides[agent.id];
  const opponentId = Object.keys(state.sides).find((id) => id !== agent.id)!;
  const opponentName = state.players.find((p) => p.agentId === opponentId)?.name ?? "Opponent";

  const opponentSpeeches = state.speeches
    .filter((s) => s.agentId === opponentId)
    .map((s) => `  [${ROUND_NAMES[s.round]}]: "${s.text}"`)
    .join("\n");

  const yourSpeeches = state.speeches
    .filter((s) => s.agentId === agent.id)
    .map((s) => `  [${ROUND_NAMES[s.round]}]: "${s.text}"`)
    .join("\n");

  return `You are in a DEBATE BATTLE on the topic: "${state.topic}"

=== YOUR ROLE ===
You are arguing: ${side}
This is the ${ROUND_NAMES[round]} round.

=== YOUR PREVIOUS SPEECHES ===
${yourSpeeches || "(none yet)"}

=== OPPONENT (${opponentName}) SPEECHES ===
${opponentSpeeches || "(none yet)"}

=== INSTRUCTIONS ===
- Argue passionately for your side: ${side}
- Stay in character with your personality
- Be entertaining, witty, and persuasive
- ${round === "opening" ? "Lay out your strongest opening arguments" : ""}${round === "rebuttal" ? "Directly address and counter your opponent's points while reinforcing your own" : ""}${round === "closing" ? "Deliver a powerful closing argument that summarizes your case and dismantles theirs" : ""}
- MAXIMUM 200 words
- Respond with ONLY your speech text, no JSON, no labels, no quotation marks around the whole thing`;
}

async function getBuiltinDebateAction(
  agent: AgentRecord,
  state: DebateGameState,
  round: "opening" | "rebuttal" | "closing",
): Promise<string> {
  const prompt = buildDebatePrompt(agent, state, round);
  const systemPrompt = agent.personality
    ? `${agent.personality} You are now in a debate. Argue passionately and stay in character. Be entertaining and persuasive.`
    : "You are a skilled debater. Argue your position with wit, passion, and sharp rhetoric.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    // Trim to ~200 words
    const words = text.split(/\s+/);
    if (words.length > 220) {
      return words.slice(0, 200).join(" ") + "...";
    }
    return text.trim();
  } catch (error) {
    console.error(`[Debate] Builtin agent ${agent.name} error:`, error);
    return "*clears throat nervously* I... seem to have lost my notes. But my position stands!";
  }
}

async function getExternalDebateAction(
  agent: AgentRecord,
  state: DebateGameState,
  round: "opening" | "rebuttal" | "closing",
): Promise<string> {
  const prompt = buildDebatePrompt(agent, state, round);

  const payload = {
    game_id: state.id,
    game_type: "debate",
    state: {
      topic: state.topic,
      side: state.sides[agent.id],
      round,
      round_name: ROUND_NAMES[round],
      speeches: state.speeches,
    },
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
    const text = typeof data === "string" ? data : (data.text ?? data.speech ?? data.response ?? "");
    const words = text.split(/\s+/);
    if (words.length > 220) {
      return words.slice(0, 200).join(" ") + "...";
    }
    return text.trim();
  } catch (error) {
    console.error(`[Debate] External agent ${agent.name} error:`, error);
    return "*technical difficulties* My position is clearly superior, even if my connection is not!";
  }
}

async function getDebateAgentSpeech(
  agent: AgentRecord,
  state: DebateGameState,
  round: "opening" | "rebuttal" | "closing",
): Promise<string> {
  if (agent.type === "external" && agent.endpoint) {
    return getExternalDebateAction(agent, state, round);
  }
  return getBuiltinDebateAction(agent, state, round);
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

async function judgeDebate(state: DebateGameState): Promise<DebateScores> {
  const player1 = state.players[0];
  const player2 = state.players[1];

  const allSpeeches = ROUNDS.map((round) => {
    const p1Speech = state.speeches.find(
      (s) => s.agentId === player1.agentId && s.round === round,
    );
    const p2Speech = state.speeches.find(
      (s) => s.agentId === player2.agentId && s.round === round,
    );
    return `=== ${ROUND_NAMES[round].toUpperCase()} ===

${player1.name} (arguing: ${state.sides[player1.agentId]}):
"${p1Speech?.text ?? "(no speech)"}"

${player2.name} (arguing: ${state.sides[player2.agentId]}):
"${p2Speech?.text ?? "(no speech)"}"`;
  }).join("\n\n");

  const judgePrompt = `You are an impartial debate judge. Score the following debate fairly.

TOPIC: "${state.topic}"

DEBATERS:
- ${player1.name} argued: ${state.sides[player1.agentId]}
- ${player2.name} argued: ${state.sides[player2.agentId]}

${allSpeeches}

Score EACH debater on these categories (1-10 each):
1. Argument Quality - Strength and logic of arguments
2. Rhetoric - Eloquence, wit, and style
3. Rebuttals - How well they countered opponent's points
4. Persuasiveness - Overall convincing power

Respond with EXACTLY this JSON format, nothing else:
{
  "${player1.agentId}": {"argumentQuality": <1-10>, "rhetoric": <1-10>, "rebuttals": <1-10>, "persuasiveness": <1-10>},
  "${player2.agentId}": {"argumentQuality": <1-10>, "rhetoric": <1-10>, "rebuttals": <1-10>, "persuasiveness": <1-10>}
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: "You are a fair and entertaining debate judge. Score debates objectively based on the quality of argumentation, not on which side you personally agree with. Always respond with valid JSON only.",
      messages: [{ role: "user", content: judgePrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in judge response");

    const parsed = JSON.parse(jsonMatch[0]);

    const scores: DebateScores = {};
    for (const player of state.players) {
      const s = parsed[player.agentId];
      if (!s) throw new Error(`Missing scores for ${player.agentId}`);
      scores[player.agentId] = {
        argumentQuality: clampScore(s.argumentQuality),
        rhetoric: clampScore(s.rhetoric),
        rebuttals: clampScore(s.rebuttals),
        persuasiveness: clampScore(s.persuasiveness),
        total:
          clampScore(s.argumentQuality) +
          clampScore(s.rhetoric) +
          clampScore(s.rebuttals) +
          clampScore(s.persuasiveness),
      };
    }

    return scores;
  } catch (error) {
    console.error("[Debate] Judge error:", error);
    // Fallback: random fair scores
    const scores: DebateScores = {};
    for (const player of state.players) {
      const aq = 5 + Math.floor(Math.random() * 4);
      const rh = 5 + Math.floor(Math.random() * 4);
      const rb = 5 + Math.floor(Math.random() * 4);
      const pe = 5 + Math.floor(Math.random() * 4);
      scores[player.agentId] = {
        argumentQuality: aq,
        rhetoric: rh,
        rebuttals: rb,
        persuasiveness: pe,
        total: aq + rh + rb + pe,
      };
    }
    return scores;
  }
}

function clampScore(n: unknown): number {
  const val = typeof n === "number" ? n : 5;
  return Math.max(1, Math.min(10, Math.round(val)));
}

// ---------------------------------------------------------------------------
// Game engine
// ---------------------------------------------------------------------------

function loadAgents(agentIds: string[]): AgentRecord[] {
  const db = getDb();
  return agentIds.map((id) => {
    const row = db.prepare(
      "SELECT id, name, type, model, personality, endpoint, api_key, avatar, elo FROM agents WHERE id = ?",
    ).get(id) as AgentRecord | undefined;
    if (!row) throw new Error(`Agent not found: ${id}`);
    return row;
  });
}

/** Run a complete debate game. Returns the final game state. */
export async function playDebateGame(playerIds: string[]): Promise<DebateGameState> {
  if (playerIds.length !== 2) {
    throw new Error("Debate requires exactly 2 players");
  }

  const agents = loadAgents(playerIds);
  const gameId = uuid();
  const db = getDb();

  // Pick topic and assign sides
  const { topic, sideA, sideB } = pickTopic();
  const sides: { [agentId: string]: string } = {};

  // Randomly assign sides
  if (Math.random() < 0.5) {
    sides[agents[0].id] = sideA;
    sides[agents[1].id] = sideB;
  } else {
    sides[agents[0].id] = sideB;
    sides[agents[1].id] = sideA;
  }

  // Create the DB record
  db.prepare(
    "INSERT INTO debate_games (id, status, players, topic, started_at, created_at) VALUES (?, 'live', ?, ?, datetime('now'), datetime('now'))",
  ).run(gameId, JSON.stringify(playerIds), topic);

  // Initialize state
  const state: DebateGameState = {
    id: gameId,
    topic,
    sides,
    round: "opening",
    speeches: [],
    scores: null,
    winner: null,
    players: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      avatar: a.avatar,
    })),
  };

  console.log(`[Debate] Game ${gameId} started: "${topic}"`);
  console.log(`[Debate] ${agents[0].name} argues: ${sides[agents[0].id]}`);
  console.log(`[Debate] ${agents[1].name} argues: ${sides[agents[1].id]}`);

  // Broadcast initial state
  liveDebateGames.set(gameId, { ...state, speeches: [...state.speeches] });

  // Run the three rounds
  for (const round of ROUNDS) {
    state.round = round;
    liveDebateGames.set(gameId, { ...state, speeches: [...state.speeches] });

    console.log(`[Debate] === ${ROUND_NAMES[round]} ===`);

    // Randomly decide who speaks first each round for variety
    const order = Math.random() < 0.5 ? [0, 1] : [1, 0];

    for (const idx of order) {
      const agent = agents[idx];

      const speech = await getDebateAgentSpeech(agent, state, round);

      state.speeches.push({
        agentId: agent.id,
        agentName: agent.name,
        round,
        side: sides[agent.id],
        text: speech,
      });

      console.log(`[Debate] ${agent.name} (${ROUND_NAMES[round]}): ${speech.slice(0, 100)}...`);

      // Update live state after every speech
      liveDebateGames.set(gameId, { ...state, speeches: [...state.speeches] });

      // Delay between speeches so spectators can read
      await new Promise((r) => setTimeout(r, 5000));
    }

    // Extra delay between rounds
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Judging phase
  state.round = "judging";
  liveDebateGames.set(gameId, { ...state, speeches: [...state.speeches] });
  console.log("[Debate] Judging in progress...");

  await new Promise((r) => setTimeout(r, 3000));

  const scores = await judgeDebate(state);
  state.scores = scores;

  // Determine winner
  const p1Id = agents[0].id;
  const p2Id = agents[1].id;
  const p1Total = scores[p1Id].total;
  const p2Total = scores[p2Id].total;

  if (p1Total > p2Total) {
    state.winner = p1Id;
  } else if (p2Total > p1Total) {
    state.winner = p2Id;
  } else {
    state.winner = "draw";
  }

  state.round = "finished";

  console.log(`[Debate] Scores: ${agents[0].name}=${p1Total}, ${agents[1].name}=${p2Total}`);
  console.log(`[Debate] Winner: ${state.winner === "draw" ? "DRAW" : state.players.find((p) => p.agentId === state.winner)?.name}`);

  // Update live state one final time before cleanup
  liveDebateGames.set(gameId, { ...state, speeches: [...state.speeches] });

  // Finish game
  finishDebateGame(state, agents, db);

  // Keep live state for a bit so spectators can see results, then clean up
  setTimeout(() => liveDebateGames.delete(gameId), 30_000);

  return state;
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

function finishDebateGame(
  state: DebateGameState,
  agents: AgentRecord[],
  db: ReturnType<typeof getDb>,
): void {
  const resultSummary = {
    topic: state.topic,
    sides: state.sides,
    scores: state.scores,
    winner: state.winner,
    speeches: state.speeches.length,
  };

  // Update DB
  db.prepare(
    "UPDATE debate_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?",
  ).run(
    JSON.stringify(state),
    JSON.stringify(resultSummary),
    state.id,
  );

  const winnerId = state.winner;
  const isDraw = winnerId === "draw";

  // Update agent stats and economics
  for (const agent of agents) {
    db.prepare(
      "UPDATE agents SET games_played = games_played + 1 WHERE id = ?",
    ).run(agent.id);

    if (isDraw) {
      db.prepare("UPDATE agents SET draws = draws + 1 WHERE id = ?").run(agent.id);
    } else if (agent.id === winnerId) {
      db.prepare("UPDATE agents SET wins = wins + 1 WHERE id = ?").run(agent.id);
      distributeWinnings(agent.id, state.id, "debate", PRIZE_POOL);
    } else {
      db.prepare("UPDATE agents SET losses = losses + 1 WHERE id = ?").run(agent.id);
      recordLoss(agent.id, state.id, "debate", 0);
    }
  }

  // Settle bets
  settleDebateBets(state.id, winnerId, isDraw);

  console.log(`[Debate] Game ${state.id} finished.`);
}

function settleDebateBets(gameId: string, winnerId: string | null, isDraw: boolean): void {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM bets WHERE game_id = ? AND game_type = 'debate' AND status = 'pending'")
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
      db.prepare("UPDATE bets SET status = 'refunded', payout = ? WHERE id = ?").run(bet.amount, bet.id);
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(bet.amount, bet.user_id);
    } else if (bet.agent_id === winnerId) {
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
