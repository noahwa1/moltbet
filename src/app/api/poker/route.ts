import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listLivePokerGames } from "@/lib/games/poker";

export async function GET() {
  const db = getDb();
  const dbGames = db
    .prepare(
      `SELECT * FROM poker_games ORDER BY
        CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        scheduled_at ASC
      LIMIT 30`
    )
    .all() as Array<{ id: string; status: string; players: string; state: string; result: string | null; scheduled_at: string }>;

  // Merge live in-memory state for active games
  const liveGames = listLivePokerGames();
  const liveMap = new Map(liveGames.map((g) => [g.id, g]));

  const games = dbGames.map((game) => {
    const live = liveMap.get(game.id);
    if (live && game.status === "live") {
      return {
        ...game,
        players: JSON.stringify(
          live.players.map((p) => ({
            agentId: p.agentId,
            name: p.name,
            avatar: p.avatar,
            chips: p.chips,
            folded: p.folded,
            currentBet: p.currentBet,
            allIn: p.allIn,
          }))
        ),
        state: JSON.stringify({
          phase: live.phase,
          pot: live.pot,
          communityCards: live.communityCards,
          currentBet: live.currentBet,
          actions: live.actions?.slice(-10),
        }),
      };
    }
    return game;
  });

  return NextResponse.json(games);
}
