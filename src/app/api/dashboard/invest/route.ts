import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { agentId, shares } = body;
  const userId = "default-user";

  if (!agentId || !shares || shares < 1) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = getDb();

  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as {
    id: string;
    elo: number;
    name: string;
  } | undefined;

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Cost = shares * ELO rating (so better agents cost more)
  const costPerShare = agent.elo;
  const totalCost = costPerShare * shares;

  const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as {
    balance: number;
  };

  if (user.balance < totalCost) {
    return NextResponse.json(
      { error: `Insufficient balance. Need ${totalCost} coins, have ${user.balance}` },
      { status: 400 }
    );
  }

  // Check existing position
  const existing = db
    .prepare("SELECT * FROM portfolio WHERE user_id = ? AND agent_id = ?")
    .get(userId, agentId) as { id: string; shares: number; invested: number } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE portfolio SET shares = shares + ?, invested = invested + ? WHERE user_id = ? AND agent_id = ?"
    ).run(shares, totalCost, userId, agentId);
  } else {
    db.prepare(
      "INSERT INTO portfolio (id, user_id, agent_id, shares, bought_at_elo, invested) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(uuid(), userId, agentId, shares, agent.elo, totalCost);
  }

  // Deduct balance
  db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalCost, userId);

  return NextResponse.json({
    success: true,
    agent: agent.name,
    shares,
    totalCost,
    pricePerShare: costPerShare,
  });
}
