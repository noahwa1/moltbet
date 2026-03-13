import { getDb } from "./db";
import { createGame, playGame } from "./game-manager";
import { playPokerGame } from "./games/poker";
import { playBattlegroundGame } from "./games/battleground";
import { playConnect4Game } from "./games/connect4";
import { playCheckersGame } from "./games/checkers";
import { playOthelloGame } from "./games/othello";
import { playLiarsDiceGame } from "./games/liars-dice";
import { playDebateGame } from "./games/debate";
import { playTriviaGame } from "./games/trivia";
import { playPrisonersDilemmaGame } from "./games/prisoners-dilemma";
import { playAuctionGame } from "./games/auction";
import { v4 as uuid } from "uuid";

let running = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

// Minimum gap between games of each type (in minutes)
const MIN_GAP_MINUTES = 5;
// How many upcoming games to keep in each queue
const CHESS_QUEUE_SIZE = 3;
const POKER_QUEUE_SIZE = 2;
const BATTLEGROUND_QUEUE_SIZE = 1;

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
    // Original games
    ensureChessGames();
    ensurePokerGames();
    ensureBattlegroundGames();
    startDueChessGames();
    startDuePokerGames();
    startDueBattlegroundGames();

    // New 1v1 games
    ensure1v1Games("connect4", "connect4_games", 2);
    ensure1v1Games("checkers", "checkers_games", 2);
    ensure1v1Games("othello", "othello_games", 2);
    ensure1v1Games("prisoners-dilemma", "prisoners_dilemma_games", 2);
    startDue1v1Games("connect4", "connect4_games", playConnect4Game);
    startDue1v1Games("checkers", "checkers_games", playCheckersGame);
    startDue1v1Games("othello", "othello_games", playOthelloGame);
    startDue1v1Games("prisoners-dilemma", "prisoners_dilemma_games", playPrisonersDilemmaGame);

    // New multiplayer games
    ensureMultiplayerGames("liars-dice", "liars_dice_games", 3, 5, 1);
    ensureMultiplayerGames("debate", "debate_games", 2, 2, 1);
    ensureMultiplayerGames("trivia", "trivia_games", 3, 5, 1);
    ensureMultiplayerGames("auction", "auction_games", 3, 5, 1);
    startDueMultiplayerGames("liars-dice", "liars_dice_games", playLiarsDiceGame);
    startDueMultiplayerGames("debate", "debate_games", playDebateGame);
    startDueMultiplayerGames("trivia", "trivia_games", playTriviaGame);
    startDueMultiplayerGames("auction", "auction_games", playAuctionGame);
  } catch (e) {
    console.error("[Scheduler] Error:", e);
  }
}

function getActiveAgents(gameMode?: string) {
  const db = getDb();
  const all = db.prepare("SELECT id, game_modes FROM agents WHERE active = 1").all() as { id: string; game_modes: string }[];
  if (!gameMode) return all;
  return all.filter(a => {
    try {
      const modes = JSON.parse(a.game_modes) as string[];
      return modes.includes(gameMode);
    } catch {
      return true;
    }
  });
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function formatDate(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}

// ─── Generic 1v1 Game Scheduling ──────────────────────────────────────────────

function ensure1v1Games(gameMode: string, table: string, queueSize: number) {
  const db = getDb();
  const pending = (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE status = 'pending'`).get() as { c: number }).c;
  const live = (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE status = 'live'`).get() as { c: number }).c;

  if (live >= 1 || pending >= queueSize) return;

  const agents = getActiveAgents(gameMode);
  if (agents.length < 2) return;

  const needed = queueSize - pending;
  let nextTime = new Date();
  nextTime.setMinutes(nextTime.getMinutes() + 1);

  for (let i = 0; i < needed; i++) {
    const pair = pickRandom(agents.map(a => a.id), 2);
    const id = uuid();
    const scheduledAt = formatDate(new Date(nextTime));

    db.prepare(
      `INSERT INTO ${table} (id, status, player_a, player_b, scheduled_at) VALUES (?, 'pending', ?, ?, ?)`
    ).run(id, pair[0], pair[1], scheduledAt);

    console.log(`[Scheduler] ${gameMode}: ${pair[0]} vs ${pair[1]} at ${scheduledAt}`);
    nextTime.setMinutes(nextTime.getMinutes() + MIN_GAP_MINUTES);
  }
}

function startDue1v1Games(
  gameMode: string,
  table: string,
  playFn: (playerIds: string[]) => Promise<unknown>
) {
  const db = getDb();
  const now = formatDate(new Date());
  const liveCount = (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE status = 'live'`).get() as { c: number }).c;
  if (liveCount >= 1) return;

  const dueGames = db.prepare(
    `SELECT id, player_a, player_b FROM ${table} WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 1`
  ).all(now) as { id: string; player_a: string; player_b: string }[];

  if (dueGames.length > 0) {
    const game = dueGames[0];
    console.log(`[Scheduler] Starting ${gameMode} game ${game.id}`);

    db.prepare(`UPDATE ${table} SET status = 'live', started_at = datetime('now') WHERE id = ?`).run(game.id);

    playFn([game.player_a, game.player_b]).then(() => {
      db.prepare(`UPDATE ${table} SET status = 'finished', finished_at = datetime('now') WHERE id = ?`).run(game.id);
    }).catch(e => {
      console.error(`[Scheduler] ${gameMode} error:`, e);
      db.prepare(`UPDATE ${table} SET status = 'finished' WHERE id = ?`).run(game.id);
    });
  }
}

// ─── Generic Multiplayer Game Scheduling ──────────────────────────────────────

function ensureMultiplayerGames(
  gameMode: string,
  table: string,
  minPlayers: number,
  maxPlayers: number,
  queueSize: number
) {
  const db = getDb();
  const pending = (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE status = 'pending'`).get() as { c: number }).c;
  const live = (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE status = 'live'`).get() as { c: number }).c;

  if (live >= 1 || pending >= queueSize) return;

  const agents = getActiveAgents(gameMode);
  if (agents.length < minPlayers) return;

  const needed = queueSize - pending;
  let nextTime = new Date();
  nextTime.setMinutes(nextTime.getMinutes() + 2);

  for (let i = 0; i < needed; i++) {
    const playerCount = Math.min(agents.length, minPlayers + Math.floor(Math.random() * (maxPlayers - minPlayers + 1)));
    const players = pickRandom(agents.map(a => a.id), playerCount);

    const id = uuid();
    const scheduledAt = formatDate(new Date(nextTime));

    const playerInfos = players.map(pid => {
      const agent = db.prepare("SELECT id, name, avatar FROM agents WHERE id = ?").get(pid) as { id: string; name: string; avatar: string };
      return { agentId: agent.id, name: agent.name, avatar: agent.avatar };
    });

    db.prepare(
      `INSERT INTO ${table} (id, status, players, scheduled_at) VALUES (?, 'pending', ?, ?)`
    ).run(id, JSON.stringify(playerInfos), scheduledAt);

    console.log(`[Scheduler] ${gameMode}: ${players.length} players at ${scheduledAt}`);
    nextTime.setMinutes(nextTime.getMinutes() + MIN_GAP_MINUTES);
  }
}

function startDueMultiplayerGames(
  gameMode: string,
  table: string,
  playFn: (playerIds: string[]) => Promise<unknown>
) {
  const db = getDb();
  const now = formatDate(new Date());
  const liveCount = (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE status = 'live'`).get() as { c: number }).c;
  if (liveCount >= 1) return;

  const dueGames = db.prepare(
    `SELECT id, players FROM ${table} WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 1`
  ).all(now) as { id: string; players: string }[];

  if (dueGames.length > 0) {
    const game = dueGames[0];
    const players = JSON.parse(game.players) as { agentId: string }[];
    const agentIds = players.map(p => p.agentId);

    console.log(`[Scheduler] Starting ${gameMode} game ${game.id}`);

    db.prepare(`UPDATE ${table} SET status = 'live', started_at = datetime('now') WHERE id = ?`).run(game.id);

    playFn(agentIds).then(() => {
      db.prepare(`UPDATE ${table} SET status = 'finished', finished_at = datetime('now') WHERE id = ?`).run(game.id);
    }).catch(e => {
      console.error(`[Scheduler] ${gameMode} error:`, e);
      db.prepare(`UPDATE ${table} SET status = 'finished' WHERE id = ?`).run(game.id);
    });
  }
}

// ─── Chess Scheduling ────────────────────────────────────────────────────────

function ensureChessGames() {
  const db = getDb();
  const pending = (db.prepare("SELECT COUNT(*) as c FROM games WHERE status = 'pending'").get() as { c: number }).c;
  const live = (db.prepare("SELECT COUNT(*) as c FROM games WHERE status = 'live'").get() as { c: number }).c;

  if (live >= 2 || pending >= CHESS_QUEUE_SIZE) return;

  const agents = getActiveAgents("chess");
  if (agents.length < 2) return;

  const needed = CHESS_QUEUE_SIZE - pending;

  const lastGame = db.prepare(
    "SELECT scheduled_at FROM games WHERE status = 'pending' ORDER BY scheduled_at DESC LIMIT 1"
  ).get() as { scheduled_at: string } | undefined;

  let nextTime = new Date();
  if (lastGame) {
    nextTime = new Date(lastGame.scheduled_at + "Z");
  }
  nextTime.setSeconds(nextTime.getSeconds() + 30);

  for (let i = 0; i < needed; i++) {
    const pair = pickRandom(agents.map(a => a.id), 2);
    const scheduledAt = new Date(nextTime);
    createGame(pair[0], pair[1], scheduledAt);
    console.log(`[Scheduler] Chess: ${pair[0]} vs ${pair[1]} at ${scheduledAt.toISOString()}`);
    nextTime.setMinutes(nextTime.getMinutes() + MIN_GAP_MINUTES);
  }
}

function startDueChessGames() {
  const db = getDb();
  const now = formatDate(new Date());
  const liveCount = (db.prepare("SELECT COUNT(*) as c FROM games WHERE status = 'live'").get() as { c: number }).c;
  if (liveCount >= 1) return;

  const dueGames = db.prepare(
    "SELECT id FROM games WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 1"
  ).all(now) as { id: string }[];

  if (dueGames.length > 0) {
    console.log(`[Scheduler] Starting chess game ${dueGames[0].id}`);
    playGame(dueGames[0].id).catch(e => console.error(`[Scheduler] Chess error:`, e));
  }
}

// ─── Poker Scheduling ────────────────────────────────────────────────────────

function ensurePokerGames() {
  const db = getDb();
  const pending = (db.prepare("SELECT COUNT(*) as c FROM poker_games WHERE status = 'pending'").get() as { c: number }).c;
  const live = (db.prepare("SELECT COUNT(*) as c FROM poker_games WHERE status = 'live'").get() as { c: number }).c;

  if (live >= 1 || pending >= POKER_QUEUE_SIZE) return;

  const agents = getActiveAgents("poker");
  if (agents.length < 3) return;

  const needed = POKER_QUEUE_SIZE - pending;

  const lastGame = db.prepare(
    "SELECT scheduled_at FROM poker_games WHERE status = 'pending' ORDER BY scheduled_at DESC LIMIT 1"
  ).get() as { scheduled_at: string } | undefined;

  let nextTime = new Date();
  if (lastGame) {
    nextTime = new Date(lastGame.scheduled_at + "Z");
  }
  nextTime.setMinutes(nextTime.getMinutes() + 1);

  for (let i = 0; i < needed; i++) {
    const playerCount = Math.min(agents.length, 3 + Math.floor(Math.random() * 3));
    const players = pickRandom(agents.map(a => a.id), playerCount);

    const id = uuid();
    const scheduledAt = formatDate(new Date(nextTime));

    const playerInfos = players.map(pid => {
      const agent = db.prepare("SELECT id, name, avatar FROM agents WHERE id = ?").get(pid) as { id: string; name: string; avatar: string };
      return { agentId: agent.id, name: agent.name, avatar: agent.avatar };
    });

    db.prepare(
      "INSERT INTO poker_games (id, status, players, scheduled_at) VALUES (?, 'pending', ?, ?)"
    ).run(id, JSON.stringify(playerInfos), scheduledAt);

    console.log(`[Scheduler] Poker: ${players.length} players at ${scheduledAt}`);
    nextTime.setMinutes(nextTime.getMinutes() + MIN_GAP_MINUTES);
  }
}

function startDuePokerGames() {
  const db = getDb();
  const now = formatDate(new Date());
  const liveCount = (db.prepare("SELECT COUNT(*) as c FROM poker_games WHERE status = 'live'").get() as { c: number }).c;
  if (liveCount >= 1) return;

  const dueGames = db.prepare(
    "SELECT id, players FROM poker_games WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 1"
  ).all(now) as { id: string; players: string }[];

  if (dueGames.length > 0) {
    const game = dueGames[0];
    const players = JSON.parse(game.players) as { agentId: string }[];
    const agentIds = players.map(p => p.agentId);

    console.log(`[Scheduler] Starting poker game ${game.id}`);

    db.prepare("UPDATE poker_games SET status = 'live', started_at = datetime('now') WHERE id = ?").run(game.id);

    playPokerGame(agentIds).then(state => {
      db.prepare(
        "UPDATE poker_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?"
      ).run(
        JSON.stringify({
          pot: state.pot,
          phase: state.phase,
          communityCards: state.communityCards,
          players: state.players.map(p => ({ ...p, holeCards: p.holeCards })),
        }),
        JSON.stringify({
          winner: state.players.find(p => !p.folded && p.chips > 0)?.agentId,
          winnerName: state.players.find(p => !p.folded && p.chips > 0)?.name,
          pot: state.pot,
        }),
        game.id
      );
    }).catch(e => {
      console.error(`[Scheduler] Poker error:`, e);
      db.prepare("UPDATE poker_games SET status = 'finished' WHERE id = ?").run(game.id);
    });
  }
}

// ─── Battleground Scheduling ─────────────────────────────────────────────────

function ensureBattlegroundGames() {
  const db = getDb();
  const pending = (db.prepare("SELECT COUNT(*) as c FROM battleground_games WHERE status = 'pending'").get() as { c: number }).c;
  const live = (db.prepare("SELECT COUNT(*) as c FROM battleground_games WHERE status = 'live'").get() as { c: number }).c;

  if (live >= 1 || pending >= BATTLEGROUND_QUEUE_SIZE) return;

  const agents = getActiveAgents("battleground");
  if (agents.length < 4) return;

  const needed = BATTLEGROUND_QUEUE_SIZE - pending;

  let nextTime = new Date();
  nextTime.setMinutes(nextTime.getMinutes() + 3);

  for (let i = 0; i < needed; i++) {
    const teamSize = Math.min(Math.floor(agents.length / 2), 2 + Math.floor(Math.random() * 2));
    const selected = pickRandom(agents.map(a => a.id), teamSize * 2);
    const teamAIds = selected.slice(0, teamSize);
    const teamBIds = selected.slice(teamSize);

    const id = uuid();
    const scheduledAt = formatDate(new Date(nextTime));

    const teamAInfos = teamAIds.map(aid => {
      const a = db.prepare("SELECT id, name, avatar FROM agents WHERE id = ?").get(aid) as { id: string; name: string; avatar: string };
      return a;
    });
    const teamBInfos = teamBIds.map(aid => {
      const a = db.prepare("SELECT id, name, avatar FROM agents WHERE id = ?").get(aid) as { id: string; name: string; avatar: string };
      return a;
    });

    db.prepare(
      "INSERT INTO battleground_games (id, status, team_a, team_b, scheduled_at) VALUES (?, 'pending', ?, ?, ?)"
    ).run(id, JSON.stringify(teamAInfos), JSON.stringify(teamBInfos), scheduledAt);

    console.log(`[Scheduler] Battleground: ${teamSize}v${teamSize} at ${scheduledAt}`);
    nextTime.setMinutes(nextTime.getMinutes() + MIN_GAP_MINUTES + 3);
  }
}

function startDueBattlegroundGames() {
  const db = getDb();
  const now = formatDate(new Date());
  const liveCount = (db.prepare("SELECT COUNT(*) as c FROM battleground_games WHERE status = 'live'").get() as { c: number }).c;
  if (liveCount >= 1) return;

  const dueGames = db.prepare(
    "SELECT id, team_a, team_b FROM battleground_games WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 1"
  ).all(now) as { id: string; team_a: string; team_b: string }[];

  if (dueGames.length > 0) {
    const game = dueGames[0];
    const teamA = JSON.parse(game.team_a) as { id: string }[];
    const teamB = JSON.parse(game.team_b) as { id: string }[];

    console.log(`[Scheduler] Starting battleground game ${game.id}`);

    db.prepare("UPDATE battleground_games SET status = 'live', started_at = datetime('now') WHERE id = ?").run(game.id);

    playBattlegroundGame(
      teamA.map(a => a.id),
      teamB.map(a => a.id)
    ).then(result => {
      db.prepare(
        "UPDATE battleground_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?"
      ).run(
        JSON.stringify(result.state),
        JSON.stringify(result.result),
        game.id
      );
    }).catch(e => {
      console.error(`[Scheduler] Battleground error:`, e);
      db.prepare("UPDATE battleground_games SET status = 'finished' WHERE id = ?").run(game.id);
    });
  }
}
