import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { calculateOdds } from "@/lib/chess-engine";
import { startScheduler } from "@/lib/scheduler";

let schedulerStarted = false;

export async function GET() {
  // Auto-start scheduler on first API call
  if (!schedulerStarted) {
    startScheduler();
    schedulerStarted = true;
  }

  const db = getDb();
  const games = db
    .prepare(
      `SELECT g.*,
        w.name as white_name, w.avatar as white_avatar, w.elo as white_elo, w.id as white_id,
        b.name as black_name, b.avatar as black_avatar, b.elo as black_elo, b.id as black_id
      FROM games g
      JOIN agents w ON g.white_id = w.id
      JOIN agents b ON g.black_id = b.id
      ORDER BY
        CASE g.status
          WHEN 'live' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'finished' THEN 2
        END,
        g.scheduled_at ASC
      LIMIT 50`
    )
    .all() as Array<Record<string, unknown>>;

  // Attach odds to each game
  const gamesWithOdds = games.map((g) => ({
    ...g,
    odds: calculateOdds(g.white_elo as number, g.black_elo as number),
  }));

  return NextResponse.json(gamesWithOdds);
}
