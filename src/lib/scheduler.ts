import { getDb } from "./db";
import { createGame, playGame } from "./game-manager";

let running = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

// How far ahead we schedule (in minutes)
const SCHEDULE_AHEAD_MINUTES = 15;
// Minimum gap between games (in minutes)
const MIN_GAP_MINUTES = 2;
// How many upcoming games to keep in the queue
const TARGET_QUEUE_SIZE = 4;

export function startScheduler() {
  if (running) return;
  running = true;

  // Run immediately, then every 10 seconds
  tick();
  intervalId = setInterval(tick, 10_000);
}

export function stopScheduler() {
  running = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function tick() {
  try {
    ensureUpcomingGames();
    startDueGames();
  } catch (e) {
    console.error("[Scheduler] Error:", e);
  }
}

function ensureUpcomingGames() {
  const db = getDb();

  // Count pending games
  const pending = db
    .prepare("SELECT COUNT(*) as c FROM games WHERE status = 'pending'")
    .get() as { c: number };

  const live = db
    .prepare("SELECT COUNT(*) as c FROM games WHERE status = 'live'")
    .get() as { c: number };

  const needed = TARGET_QUEUE_SIZE - pending.c;

  // Don't schedule more if there's already a live game (keep it focused)
  if (live.c >= 2) return;

  if (needed <= 0) return;

  const agents = db.prepare("SELECT id FROM agents").all() as { id: string }[];
  if (agents.length < 2) return;

  // Get the last scheduled game time
  const lastGame = db
    .prepare(
      "SELECT scheduled_at FROM games WHERE status = 'pending' ORDER BY scheduled_at DESC LIMIT 1"
    )
    .get() as { scheduled_at: string } | undefined;

  let nextTime: Date;
  if (lastGame) {
    nextTime = new Date(lastGame.scheduled_at + "Z");
    nextTime.setMinutes(nextTime.getMinutes() + MIN_GAP_MINUTES);
  } else {
    // First game starts 30 seconds from now
    nextTime = new Date();
    nextTime.setSeconds(nextTime.getSeconds() + 30);
  }

  for (let i = 0; i < needed; i++) {
    // Pick two random different agents, weighted by avoiding recent matchups
    const pair = pickMatchup(agents.map((a) => a.id));

    const scheduledAt = new Date(nextTime);
    const gameId = createGame(pair[0], pair[1], scheduledAt);

    console.log(
      `[Scheduler] Scheduled game ${gameId}: ${pair[0]} vs ${pair[1]} at ${scheduledAt.toISOString()}`
    );

    nextTime.setMinutes(nextTime.getMinutes() + MIN_GAP_MINUTES);
  }
}

function pickMatchup(agentIds: string[]): [string, string] {
  // Shuffle and pick first two
  const shuffled = [...agentIds].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function startDueGames() {
  const db = getDb();
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");

  // Find games that are due to start
  const dueGames = db
    .prepare(
      "SELECT id FROM games WHERE status = 'pending' AND scheduled_at <= ?"
    )
    .all(now) as { id: string }[];

  // Only start one game at a time to keep things watchable
  const liveCount = (
    db
      .prepare("SELECT COUNT(*) as c FROM games WHERE status = 'live'")
      .get() as { c: number }
  ).c;

  if (liveCount >= 1) return;

  if (dueGames.length > 0) {
    const gameId = dueGames[0].id;
    console.log(`[Scheduler] Starting game ${gameId}`);
    playGame(gameId).catch((e) =>
      console.error(`[Scheduler] Game ${gameId} error:`, e)
    );
  }
}
