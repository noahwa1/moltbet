import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listLiveDebateGames } from "@/lib/games/debate";

export async function GET() {
  const db = getDb();
  const dbGames = db
    .prepare(
      `SELECT * FROM debate_games ORDER BY
        CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        scheduled_at ASC
      LIMIT 30`
    )
    .all() as Array<{ id: string; status: string; state: string; result: string | null }>;

  const liveGames = listLiveDebateGames();
  const liveMap = new Map(liveGames.map((g) => [g.id, g]));

  const games = dbGames.map((game) => {
    const live = liveMap.get(game.id);
    if (live && game.status === "live") {
      return { ...game, state: JSON.stringify(live) };
    }
    return game;
  });

  return NextResponse.json(games);
}
