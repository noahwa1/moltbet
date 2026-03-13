import { getDb } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import { distributeWinnings, recordLoss } from "@/lib/economics";

// In-memory live state for spectating
const liveTriviaGames = new Map<string, TriviaGameState>();

export function getLiveTriviaGame(id: string): TriviaGameState | undefined {
  return liveTriviaGames.get(id);
}

export function listLiveTriviaGames(): TriviaGameState[] {
  return Array.from(liveTriviaGames.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriviaPlayer {
  agentId: string;
  name: string;
  avatar: string;
  score: number;
  streak: number;
  lastAnswer: string | null;
  lastCorrect: boolean | null;
}

export interface TriviaAnswer {
  agentId: string;
  playerName: string;
  answer: string;
  correct: boolean;
  points: number;
  comment: string;
  revealOrder: number;
}

export interface TriviaGameState {
  id: string;
  currentRound: number;
  totalRounds: number;
  category: string;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  players: TriviaPlayer[];
  answers: TriviaAnswer[];
  correctAnswer: string;
  phase: "question" | "answering" | "reveal" | "finished";
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

interface TriviaQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: string;
}

interface AgentAnswerResult {
  answer: string;
  comment: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_ROUNDS = 10;
const CORRECT_POINTS = 100;
const SPEED_BONUS_FIRST = 50;
const SPEED_BONUS_SECOND = 25;
const EXTERNAL_TIMEOUT_MS = 15_000;

const CATEGORIES = [
  "Science",
  "History",
  "Pop Culture",
  "Sports",
  "Geography",
  "Tech",
  "Nature",
  "Food",
  "Music",
  "Movies",
];

const PRIZE_POOL = 500;
const PRIZE_FIRST = 300;
const PRIZE_SECOND = 150;
const PRIZE_THIRD = 50;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Question generation
// ---------------------------------------------------------------------------

async function generateQuestion(category: string): Promise<TriviaQuestion> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: "You are a trivia quizmaster. Return only valid JSON, nothing else.",
      messages: [
        {
          role: "user",
          content: `Generate a ${category} trivia question with 4 options (A, B, C, D). Make it challenging but fair. Return JSON: {"question": "...", "options": {"A": "...", "B": "...", "C": "...", "D": "..."}, "correct": "A"}`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in quizmaster response");

    const parsed = JSON.parse(jsonMatch[0]);
    // Validate
    if (
      !parsed.question ||
      !parsed.options?.A ||
      !parsed.options?.B ||
      !parsed.options?.C ||
      !parsed.options?.D ||
      !["A", "B", "C", "D"].includes(parsed.correct)
    ) {
      throw new Error("Invalid question format");
    }

    return {
      question: parsed.question,
      options: parsed.options,
      correct: parsed.correct,
    };
  } catch (error) {
    console.error(`[Trivia] Failed to generate question for ${category}:`, error);
    // Fallback question
    return {
      question: `Which of these is most associated with the category "${category}"?`,
      options: {
        A: "Alpha",
        B: "Beta",
        C: "Gamma",
        D: "Delta",
      },
      correct: "A",
    };
  }
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

function buildTriviaPrompt(
  state: TriviaGameState,
  playerIndex: number,
): string {
  const player = state.players[playerIndex];
  const scoreboard = state.players
    .map((p) => {
      const streakText = p.streak > 1 ? ` (${p.streak} streak)` : "";
      return `  - ${p.name} ${p.avatar}: ${p.score} pts${streakText}`;
    })
    .join("\n");

  return `You are playing a trivia game.

=== ROUND ${state.currentRound}/${state.totalRounds} ===
Category: ${state.category}

=== QUESTION ===
${state.question}

A) ${state.options.A}
B) ${state.options.B}
C) ${state.options.C}
D) ${state.options.D}

=== SCOREBOARD ===
${scoreboard}

=== YOUR INFO ===
Name: ${player.name}
Your score: ${player.score}
Your streak: ${player.streak}

You MUST pick one of: A, B, C, or D.

Respond with EXACTLY this JSON format, nothing else:
{"answer": "A", "comment": "<brief in-character reaction, max 80 chars>"}`;
}

function parseAgentAnswer(text: string): AgentAnswerResult {
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { answer: "A", comment: "*couldn't decide*" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const answer = typeof parsed.answer === "string" ? parsed.answer.toUpperCase() : "A";
    const comment = typeof parsed.comment === "string" ? parsed.comment.slice(0, 80) : "";

    if (!["A", "B", "C", "D"].includes(answer)) {
      return { answer: "A", comment: comment || "*picked randomly*" };
    }

    return { answer, comment };
  } catch {
    return { answer: "A", comment: "*error parsing answer*" };
  }
}

async function getBuiltinAction(
  agent: AgentRecord,
  prompt: string,
): Promise<AgentAnswerResult> {
  const systemPrompt = agent.personality
    ? `${agent.personality} You are now playing a trivia game. Your personality should influence HOW you answer (confident, uncertain, etc.) but you must pick A, B, C, or D.`
    : "You are a trivia contestant. Pick the best answer.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    return parseAgentAnswer(text);
  } catch (error) {
    console.error(`[Trivia] Builtin agent ${agent.name} error:`, error);
    return { answer: "A", comment: "*connection issues*" };
  }
}

async function getExternalAction(
  agent: AgentRecord,
  state: TriviaGameState,
  playerIndex: number,
  prompt: string,
): Promise<AgentAnswerResult> {
  const payload = {
    game_id: state.id,
    game_type: "trivia",
    state: {
      round: state.currentRound,
      total_rounds: state.totalRounds,
      category: state.category,
      question: state.question,
      options: state.options,
      scores: state.players.map((p) => ({
        name: p.name,
        score: p.score,
        streak: p.streak,
      })),
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
    const text = JSON.stringify(data);
    return parseAgentAnswer(text);
  } catch (error) {
    console.error(`[Trivia] External agent ${agent.name} error:`, error);
    return { answer: "A", comment: "*timed out*" };
  }
}

async function getTriviaAgentAction(
  agent: AgentRecord,
  state: TriviaGameState,
  playerIndex: number,
): Promise<AgentAnswerResult> {
  const prompt = buildTriviaPrompt(state, playerIndex);

  if (agent.type === "external" && agent.endpoint) {
    return getExternalAction(agent, state, playerIndex, prompt);
  }
  return getBuiltinAction(agent, prompt);
}

// ---------------------------------------------------------------------------
// Agent loading
// ---------------------------------------------------------------------------

function loadAgents(agentIds: string[]): AgentRecord[] {
  const db = getDb();
  return agentIds.map((id) => {
    const row = db
      .prepare(
        "SELECT id, name, type, model, personality, endpoint, api_key, avatar, elo FROM agents WHERE id = ?",
      )
      .get(id) as AgentRecord | undefined;
    if (!row) throw new Error(`Agent not found: ${id}`);
    return row;
  });
}

// ---------------------------------------------------------------------------
// Game engine
// ---------------------------------------------------------------------------

export async function playTriviaGame(
  playerIds: string[],
): Promise<TriviaGameState> {
  if (playerIds.length < 3 || playerIds.length > 5) {
    throw new Error("Trivia requires 3-5 players");
  }

  const agents = loadAgents(playerIds);
  const gameId = uuid();
  const db = getDb();

  // Create the DB record
  db.prepare(
    "INSERT INTO trivia_games (id, status, players, started_at, created_at) VALUES (?, 'live', ?, datetime('now'), datetime('now'))",
  ).run(gameId, JSON.stringify(playerIds));

  // Initialize state
  const state: TriviaGameState = {
    id: gameId,
    currentRound: 0,
    totalRounds: TOTAL_ROUNDS,
    category: "",
    question: "",
    options: { A: "", B: "", C: "", D: "" },
    players: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      avatar: a.avatar,
      score: 0,
      streak: 0,
      lastAnswer: null,
      lastCorrect: null,
    })),
    answers: [],
    correctAnswer: "",
    phase: "question",
  };

  console.log(
    `[Trivia] Game ${gameId} started with ${playerIds.length} players: ${agents.map((a) => a.name).join(", ")}`,
  );

  // Play all rounds
  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    state.currentRound = round;
    state.category = CATEGORIES[round - 1];
    state.answers = [];
    state.correctAnswer = "";
    state.phase = "question";

    // Generate the question
    const triviaQ = await generateQuestion(state.category);
    state.question = triviaQ.question;
    state.options = triviaQ.options;
    state.correctAnswer = ""; // Hidden during answering

    console.log(
      `[Trivia] Round ${round}/${TOTAL_ROUNDS} - ${state.category}: ${triviaQ.question}`,
    );

    // Show question to spectators
    liveTriviaGames.set(gameId, deepCopyState(state));
    await delay(3000);

    // Answering phase
    state.phase = "answering";
    liveTriviaGames.set(gameId, deepCopyState(state));

    // Collect answers from all players (sequentially, but answers hidden)
    const roundAnswers: Array<{
      agentId: string;
      playerName: string;
      answer: string;
      comment: string;
      answeredAt: number;
    }> = [];

    for (let i = 0; i < state.players.length; i++) {
      const agent = agents.find((a) => a.id === state.players[i].agentId)!;
      const startTime = Date.now();
      const result = await getTriviaAgentAction(agent, state, i);
      const answeredAt = Date.now() - startTime;

      roundAnswers.push({
        agentId: state.players[i].agentId,
        playerName: state.players[i].name,
        answer: result.answer,
        comment: result.comment,
        answeredAt,
      });

      console.log(
        `[Trivia] ${state.players[i].name} answered: ${result.answer} - "${result.comment}"`,
      );
    }

    // Score answers
    // Sort by response time for speed bonus ordering
    const sortedBySpeed = [...roundAnswers].sort(
      (a, b) => a.answeredAt - b.answeredAt,
    );
    let correctCount = 0;

    const scoredAnswers: TriviaAnswer[] = roundAnswers.map((ra) => {
      const isCorrect = ra.answer === triviaQ.correct;
      let points = 0;

      if (isCorrect) {
        points = CORRECT_POINTS;
        // Determine speed bonus based on order among correct answers
        const speedRank = sortedBySpeed
          .filter((s) => s.answer === triviaQ.correct)
          .findIndex((s) => s.agentId === ra.agentId);
        if (speedRank === 0) points += SPEED_BONUS_FIRST;
        else if (speedRank === 1) points += SPEED_BONUS_SECOND;
        correctCount++;
      }

      // Update player score and streak
      const player = state.players.find((p) => p.agentId === ra.agentId)!;
      player.score += points;
      player.lastAnswer = ra.answer;
      player.lastCorrect = isCorrect;
      if (isCorrect) {
        player.streak += 1;
      } else {
        player.streak = 0;
      }

      return {
        agentId: ra.agentId,
        playerName: ra.playerName,
        answer: ra.answer,
        correct: isCorrect,
        points,
        comment: ra.comment,
        revealOrder: 0,
      };
    });

    // Randomize reveal order for dramatic effect
    const revealOrder = [...Array(scoredAnswers.length).keys()];
    for (let i = revealOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [revealOrder[i], revealOrder[j]] = [revealOrder[j], revealOrder[i]];
    }
    scoredAnswers.forEach((sa, idx) => {
      sa.revealOrder = revealOrder[idx];
    });

    // Reveal phase - show answers one by one
    state.phase = "reveal";
    state.correctAnswer = triviaQ.correct;

    // Reveal answers one at a time in reveal order
    const sortedByReveal = [...scoredAnswers].sort(
      (a, b) => a.revealOrder - b.revealOrder,
    );

    for (const answer of sortedByReveal) {
      state.answers.push(answer);
      liveTriviaGames.set(gameId, deepCopyState(state));
      await delay(2000); // 2s per answer reveal
    }

    // Show correct answer with full scoreboard
    liveTriviaGames.set(gameId, deepCopyState(state));
    await delay(3000); // 3s for correct answer reveal

    console.log(
      `[Trivia] Correct answer: ${triviaQ.correct} (${triviaQ.options[triviaQ.correct as keyof typeof triviaQ.options]}). ${correctCount}/${state.players.length} got it right.`,
    );
    console.log(
      `[Trivia] Scores: ${state.players.map((p) => `${p.name}: ${p.score}`).join(", ")}`,
    );
  }

  // Game finished
  state.phase = "finished";
  liveTriviaGames.set(gameId, deepCopyState(state));

  // Determine final standings
  const standings = [...state.players].sort((a, b) => b.score - a.score);

  console.log(`[Trivia] Game ${gameId} finished!`);
  standings.forEach((p, i) => {
    console.log(`[Trivia]   ${i + 1}. ${p.name} ${p.avatar}: ${p.score} pts`);
  });

  // Build result summary
  const resultSummary = {
    standings: standings.map((p, i) => ({
      place: i + 1,
      agentId: p.agentId,
      name: p.name,
      score: p.score,
    })),
  };

  // Update DB
  db.prepare(
    "UPDATE trivia_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(state), JSON.stringify(resultSummary), gameId);

  // Settlement
  const prizeDistribution = [
    { place: 0, amount: PRIZE_FIRST },
    { place: 1, amount: PRIZE_SECOND },
    { place: 2, amount: PRIZE_THIRD },
  ];

  const winnerIds = new Set<string>();

  for (const prize of prizeDistribution) {
    if (prize.place < standings.length) {
      const player = standings[prize.place];
      winnerIds.add(player.agentId);

      distributeWinnings(player.agentId, gameId, "trivia", prize.amount);

      db.prepare(
        "UPDATE agents SET games_played = games_played + 1, wins = wins + 1 WHERE id = ?",
      ).run(player.agentId);

      console.log(
        `[Trivia] ${player.name} earns ${prize.amount} coins (${prize.place + 1}${["st", "nd", "rd"][prize.place]} place)`,
      );
    }
  }

  // Record losses for players outside top 3
  for (const player of standings.slice(prizeDistribution.length)) {
    db.prepare(
      "UPDATE agents SET games_played = games_played + 1, losses = losses + 1 WHERE id = ?",
    ).run(player.agentId);

    recordLoss(player.agentId, gameId, "trivia", 0);
  }

  // Also mark games_played for top-3 who already got wins
  // (already handled above)

  // Settle trivia bets
  settleTriviaBets(gameId, winnerIds);

  // Clean up live state after a moment
  setTimeout(() => {
    liveTriviaGames.delete(gameId);
  }, 30_000);

  console.log(`[Trivia] Game ${gameId} settled.`);

  return state;
}

// ---------------------------------------------------------------------------
// Bet settlement
// ---------------------------------------------------------------------------

function settleTriviaBets(gameId: string, winnerIds: Set<string>): void {
  const db = getDb();
  const bets = db
    .prepare(
      "SELECT * FROM bets WHERE game_id = ? AND game_type = 'trivia' AND status = 'pending'",
    )
    .all(gameId) as Array<{
    id: string;
    user_id: string;
    agent_id: string;
    amount: number;
    odds: number;
  }>;

  for (const bet of bets) {
    if (winnerIds.has(bet.agent_id)) {
      const payout = Math.round(bet.amount * bet.odds);
      db.prepare("UPDATE bets SET status = 'won', payout = ? WHERE id = ?").run(
        payout,
        bet.id,
      );
      db.prepare(
        "UPDATE users SET balance = balance + ?, total_won = total_won + ? WHERE id = ?",
      ).run(payout, payout, bet.user_id);
    } else {
      db.prepare("UPDATE bets SET status = 'lost', payout = 0 WHERE id = ?").run(
        bet.id,
      );
      db.prepare(
        "UPDATE users SET total_lost = total_lost + ? WHERE id = ?",
      ).run(bet.amount, bet.user_id);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepCopyState(state: TriviaGameState): TriviaGameState {
  return {
    ...state,
    options: { ...state.options },
    players: state.players.map((p) => ({ ...p })),
    answers: state.answers.map((a) => ({ ...a })),
  };
}
