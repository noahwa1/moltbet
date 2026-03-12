import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = 'default-user'").get();

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
      WHERE b.user_id = 'default-user'
      ORDER BY b.created_at DESC
      LIMIT 20`
    )
    .all();

  return NextResponse.json({ user, bets: recentBets });
}
