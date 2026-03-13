import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const db = getDb();
  const agents = db
    .prepare("SELECT * FROM agents ORDER BY elo DESC")
    .all();
  return NextResponse.json(agents);
}

export async function DELETE(request: NextRequest) {
  const authUser = getCurrentUser(request);
  if (!authUser || !authUser.is_admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { agentId } = await request.json();
  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }

  const db = getDb();

  const agent = db.prepare("SELECT id, name FROM agents WHERE id = ?").get(agentId) as { id: string; name: string } | undefined;
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Soft-delete: deactivate rather than removing data
  db.prepare("UPDATE agents SET active = 0 WHERE id = ?").run(agentId);

  return NextResponse.json({ success: true, name: agent.name, message: `${agent.name} has been deactivated` });
}
