import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "moltbet.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initDb(db);
  }
  return db;
}

function initDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'builtin',
      model TEXT DEFAULT NULL,
      personality TEXT DEFAULT NULL,
      endpoint TEXT DEFAULT NULL,
      api_key TEXT DEFAULT NULL,
      avatar TEXT NOT NULL,
      elo INTEGER DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      owner_id TEXT DEFAULT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      white_id TEXT NOT NULL REFERENCES agents(id),
      black_id TEXT NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'pending',
      fen TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      pgn TEXT DEFAULT '',
      moves TEXT DEFAULT '[]',
      result TEXT,
      scheduled_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      balance INTEGER DEFAULT 10000,
      total_won INTEGER DEFAULT 0,
      total_lost INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      game_id TEXT NOT NULL REFERENCES games(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      amount INTEGER NOT NULL,
      odds REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payout INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed agents if empty
  const count = db.prepare("SELECT COUNT(*) as c FROM agents").get() as { c: number };
  if (count.c === 0) {
    seedAgents(db);
  }

  // Seed a default user
  const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (userCount.c === 0) {
    db.prepare("INSERT INTO users (id, name, balance) VALUES (?, ?, ?)").run(
      "default-user",
      "You",
      10000
    );
  }
}

function seedAgents(db: Database.Database) {
  const agents = [
    {
      id: "stockfish-claude",
      name: "The Grandmaster",
      type: "builtin",
      model: "claude-sonnet-4-6",
      personality:
        "You are a world-class chess grandmaster. You play precise, positional chess. You calculate deeply and prefer strategic advantages over flashy tactics. You occasionally comment on your moves with quiet confidence.",
      avatar: "👑",
      elo: 1400,
    },
    {
      id: "aggressive-claude",
      name: "Blitz Demon",
      type: "builtin",
      model: "claude-sonnet-4-6",
      personality:
        "You are an aggressive, attacking chess player. You love sacrifices, gambits, and wild tactical complications. You'd rather lose spectacularly than win boringly. You trash-talk your opponent playfully.",
      avatar: "⚡",
      elo: 1350,
    },
    {
      id: "defensive-claude",
      name: "The Wall",
      type: "builtin",
      model: "claude-sonnet-4-6",
      personality:
        "You are an extremely defensive chess player. You build impenetrable fortresses and wait for your opponent to overextend. Patience is your weapon. You speak in calm, measured tones.",
      avatar: "🛡️",
      elo: 1300,
    },
    {
      id: "chaotic-claude",
      name: "Chaos Engine",
      type: "builtin",
      model: "claude-haiku-4-5-20251001",
      personality:
        "You are an unpredictable chess player who loves unusual openings and bizarre strategies. You play moves that confuse opponents. You speak in riddles and non-sequiturs.",
      avatar: "🎲",
      elo: 1150,
    },
    {
      id: "scholar-claude",
      name: "The Professor",
      type: "builtin",
      model: "claude-sonnet-4-6",
      personality:
        "You are a chess scholar who plays based on deep opening theory and endgame knowledge. You reference famous games and players. You explain your reasoning like a teacher.",
      avatar: "📚",
      elo: 1380,
    },
    {
      id: "rookie-claude",
      name: "Lucky Beginner",
      type: "builtin",
      model: "claude-haiku-4-5-20251001",
      personality:
        "You are a beginner chess player who sometimes stumbles into brilliant moves by accident. You are enthusiastic but not always strategic. You celebrate every move like it's the best move ever played.",
      avatar: "🍀",
      elo: 1050,
    },
  ];

  const stmt = db.prepare(
    "INSERT INTO agents (id, name, type, model, personality, avatar, elo) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const a of agents) {
    stmt.run(a.id, a.name, a.type, a.model, a.personality, a.avatar, a.elo);
  }
}
