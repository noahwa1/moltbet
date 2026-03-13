import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveGame } from "@/lib/game-manager";
import { getOddsHistory, rebuildOddsHistory } from "@/lib/live-odds";
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
  let history = getOddsHistory(id);

  // Generate betting lines for non-finished games
  let moveHistory: string[] = [];
  let currentFen = g.fen as string;
  let currentMoves = g.moves as string;
  let parsedMoves: Array<{ san: string; fen: string }> = [];

  if (activeGame) {
    currentFen = activeGame.fen;
    currentMoves = JSON.stringify(activeGame.moves);
    try {
      parsedMoves = activeGame.moves as Array<{ san: string; fen: string }>;
      moveHistory = parsedMoves.map((m) => m.san);
    } catch { /* empty */ }
  } else {
    try {
      parsedMoves = JSON.parse((g.moves as string) || "[]");
      moveHistory = parsedMoves.map((m) => m.san);
    } catch { /* empty */ }
  }

  // Rebuild odds history if in-memory was lost (e.g. after redeploy) but game has moves
  if (history.length === 0 && parsedMoves.length >= 2) {
    history = rebuildOddsHistory(
      id,
      g.white_id as string,
      g.black_id as string,
      parsedMoves
    );
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
      oddsHistory: history,
      lines,
    });
  }

  return NextResponse.json({
    ...game,
    liveOdds: null,
    oddsHistory: history,
    lines,
  });
}
