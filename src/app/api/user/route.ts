import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const db = getDb();

  const authUser = getCurrentUser(request);
  const userId = authUser?.id ?? "default-user";

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

  const recentBets = db
    .prepare(
      `SELECT b.*,
        a.name as agent_name, a.avatar as agent_avatar,
        g.result,
        w.name as white_name, bl.name as black_name
      FROM bets b
      JOIN agents a ON b.agent_id = a.id
      JOIN games g ON b.game_id = g.id
      JOIN agents w ON g.white_id = w.id
      JOIN agents bl ON g.black_id = bl.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT 20`
    )
    .all(userId);

  return NextResponse.json({ user, bets: recentBets, loggedIn: !!authUser });
}
