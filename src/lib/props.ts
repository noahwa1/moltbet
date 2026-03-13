import { getDb } from "./db";
import { v4 as uuid } from "uuid";

interface Agent {
  id: string;
  name: string;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  games_played: number;
}

interface PropBet {
  id: string;
  question: string;
  category: string;
  agent_id: string | null;
  options: string;
  correct_option: string | null;
  status: string;
  closes_at: string | null;
  created_at: string;
  agent_name?: string;
  agent_avatar?: string;
  wager_count?: number;
  total_wagered?: number;
}

/**
 * Generate daily prop bets based on current agent data.
 * Called once per day or on demand.
 */
export function generateDailyProps(): PropBet[] {
  const db = getDb();

  // Check if we already generated props today
  const todayProps = db
    .prepare(
      "SELECT COUNT(*) as c FROM prop_bets WHERE date(created_at) = date('now') AND category = 'daily'"
    )
    .get() as { c: number };

  if (todayProps.c >= 5) {
    return getActiveProps();
  }

  const agents = db
    .prepare("SELECT * FROM agents WHERE active = 1 ORDER BY games_played DESC LIMIT 20")
    .all() as Agent[];

  if (agents.length < 2) return [];

  const props: Array<{
    question: string;
    agent_id: string | null;
    options: string[];
    category: string;
  }> = [];

  // Pick random agents for props
  const shuffle = <T>(arr: T[]) => arr.sort(() => Math.random() - 0.5);
  const picked = shuffle([...agents]);

  // 1. "How many wins will [agent] get today?"
  if (picked[0]) {
    const a = picked[0];
    props.push({
      question: `How many wins will ${a.name} ${a.avatar} get today?`,
      agent_id: a.id,
      options: ["0 wins", "1 win", "2 wins", "3+ wins"],
      category: "daily",
    });
  }

  // 2. "Will [agent] beat [agent] in their next match?"
  if (picked[0] && picked[1]) {
    props.push({
      question: `Will ${picked[0].name} ${picked[0].avatar} beat ${picked[1].name} ${picked[1].avatar} in their next match?`,
      agent_id: picked[0].id,
      options: [`${picked[0].name} wins`, `${picked[1].name} wins`, "Draw"],
      category: "matchup",
    });
  }

  // 3. "Which agent will have the highest ELO at end of day?"
  if (agents.length >= 3) {
    const top3 = agents.slice(0, 3);
    props.push({
      question: "Which agent will have the highest ELO at end of day?",
      agent_id: null,
      options: top3.map((a) => `${a.name} ${a.avatar}`),
      category: "daily",
    });
  }

  // 4. "Total games played across all agents today — over/under?"
  const avgGames = Math.max(5, Math.round(agents.length * 1.5));
  props.push({
    question: `Total games played today — Over or Under ${avgGames}?`,
    agent_id: null,
    options: [`Over ${avgGames}`, `Under ${avgGames}`],
    category: "daily",
  });

  // 5. "Will any agent hit a 3-game win streak today?"
  props.push({
    question: "Will any agent hit a 3-game win streak today?",
    agent_id: null,
    options: ["Yes", "No"],
    category: "daily",
  });

  // 6. "Will [agent] go undefeated today?"
  if (picked[2]) {
    const a = picked[2];
    props.push({
      question: `Will ${a.name} ${a.avatar} go undefeated today?`,
      agent_id: a.id,
      options: ["Yes — undefeated", "No — at least one loss"],
      category: "daily",
    });
  }

  // 7. "Longest game today — Over/Under N moves?"
  const moveLine = 60 + Math.floor(Math.random() * 40);
  props.push({
    question: `Longest chess game today — Over or Under ${moveLine} moves?`,
    agent_id: null,
    options: [`Over ${moveLine}`, `Under ${moveLine}`],
    category: "daily",
  });

  // 8. "Which game type will have the most upsets today?"
  props.push({
    question: "Which game type will have the most upsets today?",
    agent_id: null,
    options: ["Chess ♟", "Poker 🃏", "Battleground ⚔️"],
    category: "daily",
  });

  // Insert props (limit to 8 per day)
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const closesAt = endOfDay.toISOString();

  const stmt = db.prepare(
    "INSERT INTO prop_bets (id, question, category, agent_id, options, status, closes_at) VALUES (?, ?, ?, ?, ?, 'open', ?)"
  );

  for (const p of props.slice(0, 8)) {
    stmt.run(uuid(), p.question, p.category, p.agent_id, JSON.stringify(p.options), closesAt);
  }

  return getActiveProps();
}

export function getActiveProps(): PropBet[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*,
        a.name as agent_name, a.avatar as agent_avatar,
        (SELECT COUNT(*) FROM prop_wagers w WHERE w.prop_id = p.id) as wager_count,
        (SELECT COALESCE(SUM(w.amount), 0) FROM prop_wagers w WHERE w.prop_id = p.id) as total_wagered
      FROM prop_bets p
      LEFT JOIN agents a ON p.agent_id = a.id
      WHERE p.status = 'open'
      ORDER BY p.created_at DESC
      LIMIT 20`
    )
    .all() as PropBet[];
}

export function placePropWager(
  propId: string,
  userId: string,
  pickedOption: string,
  amount: number
): { id: string; odds: number } {
  const db = getDb();

  const prop = db.prepare("SELECT * FROM prop_bets WHERE id = ?").get(propId) as PropBet | undefined;
  if (!prop) throw new Error("Prop not found");
  if (prop.status !== "open") throw new Error("Prop is closed");

  const options = JSON.parse(prop.options) as string[];
  if (!options.includes(pickedOption)) throw new Error("Invalid option");

  // Check user balance
  const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number } | undefined;
  if (!user || user.balance < amount) throw new Error("Insufficient balance");

  // Calculate odds based on number of options + current wager distribution
  const wagers = db
    .prepare("SELECT picked_option, SUM(amount) as total FROM prop_wagers WHERE prop_id = ? GROUP BY picked_option")
    .all(propId) as Array<{ picked_option: string; total: number }>;

  const totalPool = wagers.reduce((s, w) => s + w.total, 0) + amount;
  const thisOptionTotal = (wagers.find((w) => w.picked_option === pickedOption)?.total ?? 0) + amount;
  const odds = Math.max(1.2, parseFloat((totalPool / thisOptionTotal).toFixed(2)));

  const id = uuid();
  db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(amount, userId);
  db.prepare(
    "INSERT INTO prop_wagers (id, prop_id, user_id, picked_option, amount, odds) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, propId, userId, pickedOption, amount, odds);

  return { id, odds };
}

export function getRecentSettledProps(): PropBet[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*,
        a.name as agent_name, a.avatar as agent_avatar
      FROM prop_bets p
      LEFT JOIN agents a ON p.agent_id = a.id
      WHERE p.status = 'settled'
      ORDER BY p.settled_at DESC
      LIMIT 10`
    )
    .all() as PropBet[];
}
