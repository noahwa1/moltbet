import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { getCurrentUser } = await import("@/lib/auth");
  const authUser = getCurrentUser(request);
  if (!authUser) {
    return NextResponse.json({
      bets: [],
      stats: { totalWagered: 0, totalWon: 0, netPnl: 0, winRate: "0.0", roi: "0.0", totalBets: 0, pendingBets: 0, wonBets: 0, lostBets: 0 },
    });
  }
  const userId = authUser.id;
  const db = getDb();

  const statusFilter = request.nextUrl.searchParams.get("status");

  // Always fetch all bets for stats computation
  const allBets = db
    .prepare(
      `SELECT b.*,
        a.name as agent_name, a.avatar as agent_avatar
      FROM bets b
      LEFT JOIN agents a ON b.agent_id = a.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC`
    )
    .all(userId) as Array<{
    id: string;
    user_id: string;
    game_id: string;
    game_type: string;
    agent_id: string;
    bet_type: string;
    line: number | null;
    side: string | null;
    amount: number;
    odds: number;
    status: string;
    payout: number;
    created_at: string;
    agent_name: string;
    agent_avatar: string;
  }>;

  // Filter for display
  const bets =
    statusFilter && statusFilter !== "all"
      ? allBets.filter((b) => b.status === statusFilter)
      : allBets;

  // Compute aggregate stats from ALL bets (not filtered)
  const totalWagered = allBets.reduce((sum, b) => sum + b.amount, 0);
  const settledBets = allBets.filter(
    (b) => b.status === "won" || b.status === "lost" || b.status === "cashed_out"
  );
  const wonBetsList = allBets.filter((b) => b.status === "won");
  const totalWon = wonBetsList.reduce((sum, b) => sum + b.payout, 0);
  const cashedOutBets = allBets.filter((b) => b.status === "cashed_out");
  const totalCashedOut = cashedOutBets.reduce((sum, b) => sum + b.payout, 0);
  const totalReturned = totalWon + totalCashedOut;
  const netPnl = totalReturned - totalWagered;
  const winCount = wonBetsList.length + cashedOutBets.length;
  const winRate =
    settledBets.length > 0
      ? ((winCount / settledBets.length) * 100).toFixed(1)
      : "0.0";
  const roi =
    totalWagered > 0
      ? ((netPnl / totalWagered) * 100).toFixed(1)
      : "0.0";

  return NextResponse.json({
    bets,
    stats: {
      totalWagered,
      totalWon: totalReturned,
      netPnl,
      winRate,
      roi,
      totalBets: allBets.length,
      pendingBets: allBets.filter((b) => b.status === "pending").length,
      wonBets: winCount,
      lostBets: allBets.filter((b) => b.status === "lost").length,
    },
  });
}
