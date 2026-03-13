import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveGame } from "@/lib/game-manager";
import { getOddsHistory } from "@/lib/live-odds";
import { generateLines } from "@/lib/betting-lines";

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

  const g = game as Record<string, unknown>;

  // If game is live, get real-time moves from memory
  const activeGame = getActiveGame(id);
  const oddsHistory = getOddsHistory(id);

  // Generate betting lines for non-finished games
  let moveHistory: string[] = [];
  let currentFen = g.fen as string;
  let currentMoves = g.moves as string;

  if (activeGame) {
    currentFen = activeGame.fen;
    currentMoves = JSON.stringify(activeGame.moves);
    try {
      moveHistory = activeGame.moves.map((m: { san: string }) => m.san);
    } catch { /* empty */ }
  } else {
    try {
      const parsed = JSON.parse((g.moves as string) || "[]");
      moveHistory = parsed.map((m: { san: string }) => m.san);
    } catch { /* empty */ }
  }

  const lines = g.status !== "finished"
    ? generateLines(id, g.white_id as string, g.black_id as string, currentFen, moveHistory)
    : null;

  if (activeGame) {
    return NextResponse.json({
      ...game,
      moves: currentMoves,
      fen: currentFen,
      status: activeGame.status,
      liveOdds: activeGame.liveOdds ?? null,
      oddsHistory,
      lines,
    });
  }

  return NextResponse.json({
    ...game,
    liveOdds: null,
    oddsHistory,
    lines,
  });
}
