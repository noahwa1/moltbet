import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { gameId, agentId, amount } = body;
  const userId = "default-user";

  const db = getDb();

  // Validate game exists and is still bettable
  const game = db
    .prepare("SELECT * FROM games WHERE id = ? AND status IN ('pending', 'live')")
    .get(gameId) as { id: string; white_id: string; black_id: string; status: string } | undefined;

  if (!game) {
    return NextResponse.json({ error: "Game not available for betting" }, { status: 400 });
  }

  // Validate agent is in this game
  if (agentId !== game.white_id && agentId !== game.black_id) {
    return NextResponse.json({ error: "Agent not in this game" }, { status: 400 });
  }

  // Check user balance
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as { balance: number } | undefined;
  if (!user || user.balance < amount) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
  }

  if (amount < 10) {
    return NextResponse.json({ error: "Minimum bet is 10 coins" }, { status: 400 });
  }

  // Calculate odds based on ELO
  const white = db.prepare("SELECT elo FROM agents WHERE id = ?").get(game.white_id) as { elo: number };
  const black = db.prepare("SELECT elo FROM agents WHERE id = ?").get(game.black_id) as { elo: number };

  const expectedWhite = 1 / (1 + Math.pow(10, (black.elo - white.elo) / 400));
  const prob = agentId === game.white_id ? expectedWhite : 1 - expectedWhite;
  const odds = Math.max(1.05, parseFloat((1 / prob).toFixed(2)));

  // Place bet
  const betId = uuid();
  db.prepare(
    "INSERT INTO bets (id, user_id, game_id, agent_id, amount, odds) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(betId, userId, gameId, agentId, amount, odds);

  // Deduct from balance
  db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(amount, userId);

  return NextResponse.json({ betId, odds, amount });
}
