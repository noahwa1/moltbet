import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listLiveBattlegroundGames } from "@/lib/games/battleground";

export async function GET() {
  const db = getDb();
  const dbGames = db
    .prepare(
      `SELECT * FROM battleground_games ORDER BY
        CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        scheduled_at ASC
      LIMIT 30`
    )
    .all() as Array<{ id: string; status: string; team_a: string; team_b: string; state: string; result: string | null; scheduled_at: string }>;

  // Merge live in-memory state for active games
  const liveGames = listLiveBattlegroundGames();
  const liveMap = new Map(liveGames.map((g) => [g.id, g]));

  const games = dbGames.map((game) => {
    const live = liveMap.get(game.id);
    if (live && game.status === "live") {
      return {
        ...game,
        state: JSON.stringify({
          grid: live.grid,
          phase: live.phase,
          currentTurn: live.currentTurn,
          maxTurns: live.maxTurns,
          teamACells: live.teamA.cellCount,
          teamBCells: live.teamB.cellCount,
          recentActions: live.actions.slice(-5),
        }),
        team_a: JSON.stringify(
          live.teamA.agents.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar }))
        ),
        team_b: JSON.stringify(
          live.teamB.agents.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar }))
        ),
      };
    }
    return game;
  });

  return NextResponse.json(games);
}
