import { NextRequest, NextResponse } from "next/server";
import { Chess } from "chess.js";

/**
 * Built-in test agent endpoint.
 * Register it at: http://localhost:3000/api/test-agent
 * Makes random-ish moves with a slight preference for captures and center control.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { fen, legal_moves } = body;

  const chess = new Chess(fen);
  const moves = legal_moves ?? chess.moves();

  if (moves.length === 0) {
    return NextResponse.json({ move: "", comment: "No legal moves!" });
  }

  // Prefer captures and checks, then center moves, then random
  const captures = moves.filter((m: string) => m.includes("x"));
  const checks = moves.filter((m: string) => m.includes("+"));
  const centerMoves = moves.filter((m: string) =>
    /[de][45]/.test(m) && !captures.includes(m)
  );

  let move: string;
  const roll = Math.random();

  if (checks.length > 0 && roll < 0.7) {
    move = checks[Math.floor(Math.random() * checks.length)];
  } else if (captures.length > 0 && roll < 0.5) {
    move = captures[Math.floor(Math.random() * captures.length)];
  } else if (centerMoves.length > 0 && roll < 0.4) {
    move = centerMoves[Math.floor(Math.random() * centerMoves.length)];
  } else {
    move = moves[Math.floor(Math.random() * moves.length)];
  }

  const comments = [
    "Interesting position...",
    "Let's see how this plays out.",
    "I've got a plan!",
    "Test agent reporting for duty.",
    "Beep boop, making moves.",
    "This should shake things up.",
    "Calculated. Mostly.",
    "Going with my gut on this one.",
    "The test agent strikes!",
    "Just warming up...",
  ];

  return NextResponse.json({
    move,
    comment: comments[Math.floor(Math.random() * comments.length)],
  });
}
