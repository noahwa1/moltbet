import Database from "better-sqlite3";
import path from "path";

// Use RAILWAY_VOLUME_MOUNT_PATH for persistent storage on Railway,
// otherwise fall back to project root for local dev
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.cwd();
const DB_PATH = path.join(DB_DIR, "moltbet.db");

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
      peak_elo INTEGER DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      owner_id TEXT DEFAULT NULL,
      team_id TEXT DEFAULT NULL,

      -- Financial
      career_earnings INTEGER DEFAULT 0,
      career_losses INTEGER DEFAULT 0,
      total_prize_pool INTEGER DEFAULT 0,
      total_dividends_paid INTEGER DEFAULT 0,
      total_shares_issued INTEGER DEFAULT 100,
      share_price INTEGER DEFAULT 100,
      management_fee_pct INTEGER DEFAULT 20,
      open_to_investors INTEGER DEFAULT 1,

      games_played INTEGER DEFAULT 0,
      game_modes TEXT NOT NULL DEFAULT '["chess","poker","battleground"]',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      elo INTEGER DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      game_type TEXT NOT NULL DEFAULT 'chess',
      prize_pool INTEGER DEFAULT 500,
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

    CREATE TABLE IF NOT EXISTS poker_games (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      players TEXT NOT NULL DEFAULT '[]',
      state TEXT DEFAULT '{}',
      rounds TEXT DEFAULT '[]',
      result TEXT,
      scheduled_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS battleground_games (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      team_a TEXT NOT NULL DEFAULT '[]',
      team_b TEXT NOT NULL DEFAULT '[]',
      state TEXT DEFAULT '{}',
      turns TEXT DEFAULT '[]',
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
      total_dividends INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      game_id TEXT NOT NULL,
      game_type TEXT NOT NULL DEFAULT 'chess',
      agent_id TEXT,
      team_id TEXT,
      bet_type TEXT NOT NULL DEFAULT 'moneyline',
      line REAL DEFAULT NULL,
      side TEXT DEFAULT NULL,
      amount INTEGER NOT NULL,
      odds REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payout INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      shares INTEGER NOT NULL DEFAULT 1,
      bought_at_price INTEGER NOT NULL,
      invested INTEGER NOT NULL,
      dividends_received INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS dividends (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      game_id TEXT NOT NULL,
      game_type TEXT NOT NULL,
      total_prize INTEGER NOT NULL,
      owner_cut INTEGER NOT NULL,
      investor_pool INTEGER NOT NULL,
      per_share_payout REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dividend_payouts (
      id TEXT PRIMARY KEY,
      dividend_id TEXT NOT NULL REFERENCES dividends(id),
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      shares INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_earnings (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      game_id TEXT NOT NULL,
      game_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Prop bets
  db.exec(`
    CREATE TABLE IF NOT EXISTS prop_bets (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'daily',
      agent_id TEXT REFERENCES agents(id),
      options TEXT NOT NULL DEFAULT '[]',
      correct_option TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      closes_at TEXT,
      settled_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prop_wagers (
      id TEXT PRIMARY KEY,
      prop_id TEXT NOT NULL REFERENCES prop_bets(id),
      user_id TEXT NOT NULL,
      picked_option TEXT NOT NULL,
      amount INTEGER NOT NULL,
      odds REAL NOT NULL DEFAULT 2.0,
      payout INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Sessions table for auth
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Safe migrations for existing DBs — never drop/recreate, only add
  safeAlter(db, "bets", "bet_type", "TEXT NOT NULL DEFAULT 'moneyline'");
  safeAlter(db, "bets", "line", "REAL DEFAULT NULL");
  safeAlter(db, "bets", "side", "TEXT DEFAULT NULL");
  safeAlter(db, "users", "password_hash", "TEXT");
  safeAlter(db, "users", "email", "TEXT");
  safeAlter(db, "users", "is_admin", "INTEGER DEFAULT 0");

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

  // Seed admin account if not exists
  seedAdmin(db);
}

function seedAdmin(db: Database.Database) {
  const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@moltbet.com'").get();
  if (!admin) {
    // Lazy-import to avoid circular deps at module load
    const { randomBytes, scryptSync } = require("crypto");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync("Toad321", salt, 64).toString("hex");
    const passwordHash = `${salt}:${hash}`;

    db.prepare(
      "INSERT OR IGNORE INTO users (id, name, email, password_hash, balance, is_admin) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("admin-user", "Admin", "admin@moltbet.com", passwordHash, 999999, 1);
  }
}

function safeAlter(db: Database.Database, table: string, column: string, definition: string) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch {
    // Table might not exist yet — CREATE TABLE IF NOT EXISTS will handle it
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
    "INSERT INTO agents (id, name, type, model, personality, avatar, elo, peak_elo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const a of agents) {
    stmt.run(a.id, a.name, a.type, a.model, a.personality, a.avatar, a.elo, a.elo);
  }
}
