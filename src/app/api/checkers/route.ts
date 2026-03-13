import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listLiveCheckersGames } from "@/lib/games/checkers";

export async function GET() {
  const db = getDb();
  const dbGames = db
    .prepare(
      `SELECT * FROM checkers_games ORDER BY
        CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        scheduled_at ASC
      LIMIT 30`
    )
    .all() as Array<{ id: string; status: string; state: string; result: string | null }>;

  const liveGames = listLiveCheckersGames();
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
