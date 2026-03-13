import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { betId } = body;
  const userId = "default-user";

  const db = getDb();

  // Fetch the bet
  const bet = db
    .prepare("SELECT * FROM bets WHERE id = ? AND user_id = ?")
    .get(betId, userId) as {
    id: string;
    game_id: string;
    game_type: string;
    amount: number;
    odds: number;
    status: string;
  } | undefined;

  if (!bet) {
    return NextResponse.json({ error: "Bet not found" }, { status: 404 });
  }

  if (bet.status !== "pending") {
    return NextResponse.json(
      { error: "Can only cash out pending bets" },
      { status: 400 }
    );
  }

  // Check the game is live (must be in-progress for cash out)
  const game = db
    .prepare("SELECT * FROM games WHERE id = ? AND status = 'live'")
    .get(bet.game_id) as { id: string; status: string } | undefined;

  if (!game) {
    return NextResponse.json(
      { error: "Game must be live to cash out" },
      { status: 400 }
    );
  }

  // Simplified cash-out calculation: originalBet * (currentOdds / originalOdds)
  // Since we don't track current odds shift per-bet perfectly, use a simplified model:
  // Cash out value = originalBet * 0.85 (house takes a small edge on early cashout)
  // In a more sophisticated system, you'd compute real-time odds shift
  const cashOutValue = Math.round(bet.amount * (bet.odds / bet.odds) * 0.85);
  // A more meaningful formula if live odds were available:
  // cashOutValue = Math.round(bet.amount * (currentOdds / bet.odds))
  // For now we give back 85% as a simplified model
  const payout = Math.max(cashOutValue, 1);

  // Update bet status to cashed_out
  db.prepare("UPDATE bets SET status = 'cashed_out', payout = ? WHERE id = ?").run(
    payout,
    betId
  );

  // Credit user balance
  db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(
    payout,
    userId
  );

  return NextResponse.json({
    success: true,
    betId,
    cashOutValue: payout,
    originalAmount: bet.amount,
  });
}
