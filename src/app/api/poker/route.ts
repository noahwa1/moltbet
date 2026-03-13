import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const games = db
    .prepare(
      `SELECT * FROM poker_games ORDER BY
        CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        scheduled_at ASC
      LIMIT 30`
    )
    .all();
  return NextResponse.json(games);
}
