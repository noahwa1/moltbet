import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function POST(request: NextRequest) {
  const { getCurrentUser } = await import("@/lib/auth");
  const authUser = getCurrentUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Sign in to invest" }, { status: 401 });
  }
  const body = await request.json();
  const { agentId, shares } = body;
  const userId = authUser.id;

  if (!agentId || !shares || shares < 1) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = getDb();

  const agent = db.prepare(
    "SELECT id, name, share_price, total_shares_issued, open_to_investors FROM agents WHERE id = ?"
  ).get(agentId) as {
    id: string;
    name: string;
    share_price: number;
    total_shares_issued: number;
    open_to_investors: number;
  } | undefined;

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (!agent.open_to_investors) {
    return NextResponse.json({ error: "This agent is not open to investors" }, { status: 400 });
  }

  // Check available float
  const held = db.prepare(
    "SELECT COALESCE(SUM(shares), 0) as total FROM portfolio WHERE agent_id = ?"
  ).get(agentId) as { total: number };

  const available = agent.total_shares_issued - held.total;
  if (shares > available) {
    return NextResponse.json(
      { error: `Only ${available} shares available (${held.total}/${agent.total_shares_issued} held)` },
      { status: 400 }
    );
  }

  const costPerShare = agent.share_price;
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
      "INSERT INTO portfolio (id, user_id, agent_id, shares, bought_at_price, invested) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(uuid(), userId, agentId, shares, costPerShare, totalCost);
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
