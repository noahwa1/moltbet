import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveGame } from "@/lib/game-manager";
import { getOddsHistory } from "@/lib/live-odds";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const game = db
    .prepare(
      `SELECT g.*,
        w.id as white_id, w.name as white_name, w.avatar as white_avatar, w.elo as white_elo, w.model as white_model,
        b.id as black_id, b.name as black_name, b.avatar as black_avatar, b.elo as black_elo, b.model as black_model
      FROM games g
      JOIN agents w ON g.white_id = w.id
      JOIN agents b ON g.black_id = b.id
      WHERE g.id = ?`
    )
    .get(id);

  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  // If game is live, get real-time moves from memory
  const activeGame = getActiveGame(id);
  const oddsHistory = getOddsHistory(id);

  if (activeGame) {
    return NextResponse.json({
      ...game,
      moves: JSON.stringify(activeGame.moves),
      fen: activeGame.fen,
      status: activeGame.status,
      liveOdds: activeGame.liveOdds ?? null,
      oddsHistory,
    });
  }

  return NextResponse.json({
    ...game,
    liveOdds: null,
    oddsHistory,
  });
}
