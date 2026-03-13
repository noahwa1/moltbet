import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";

// Create a team
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, avatar, agentIds } = body;
  const userId = "default-user";

  if (!name || !agentIds || agentIds.length < 2) {
    return NextResponse.json(
      { error: "Team needs a name and at least 2 agents" },
      { status: 400 }
    );
  }

  if (agentIds.length > 4) {
    return NextResponse.json(
      { error: "Max 4 agents per team" },
      { status: 400 }
    );
  }

  const db = getDb();

  // Verify all agents exist and user owns shares in them
  for (const agentId of agentIds) {
    const agent = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId);
    if (!agent) {
      return NextResponse.json({ error: `Agent ${agentId} not found` }, { status: 404 });
    }

    const ownership = db
      .prepare("SELECT shares FROM portfolio WHERE user_id = ? AND agent_id = ?")
      .get(userId, agentId) as { shares: number } | undefined;

    if (!ownership || ownership.shares < 1) {
      return NextResponse.json(
        { error: `You must own shares in all team agents. Missing: ${agentId}` },
        { status: 400 }
      );
    }
  }

  const teamId = uuid();
  db.prepare(
    "INSERT INTO teams (id, name, avatar, owner_id) VALUES (?, ?, ?, ?)"
  ).run(teamId, name, avatar || "⚔️", userId);

  // Assign agents to team
  for (const agentId of agentIds) {
    db.prepare("UPDATE agents SET team_id = ? WHERE id = ?").run(teamId, agentId);
  }

  return NextResponse.json({
    id: teamId,
    name,
    agents: agentIds,
  });
}

// List teams
export async function GET() {
  const db = getDb();
  const teams = db
    .prepare(
      `SELECT t.*,
        json_group_array(json_object('id', a.id, 'name', a.name, 'avatar', a.avatar, 'elo', a.elo)) as members
      FROM teams t
      LEFT JOIN agents a ON a.team_id = t.id
      GROUP BY t.id
      ORDER BY t.elo DESC`
    )
    .all();

  return NextResponse.json(teams);
}
