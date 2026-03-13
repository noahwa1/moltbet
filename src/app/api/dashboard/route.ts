import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { getCurrentUser } = await import("@/lib/auth");
  const authUser = getCurrentUser(request);
  const userId = authUser?.id ?? "guest";
  const db = getDb();

  const user = (db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown>) ?? {
    id: "guest",
    balance: 0,
    total_won: 0,
    total_lost: 0,
  };

  const agents = db
    .prepare(
      `SELECT a.*,
        COALESCE(p.shares, 0) as user_shares,
        COALESCE(p.invested, 0) as user_invested,
        COALESCE(p.dividends_received, 0) as user_dividends
      FROM agents a
      LEFT JOIN portfolio p ON p.agent_id = a.id AND p.user_id = ?
      ORDER BY a.share_price DESC`
    )
    .all(userId);

  const portfolio = db
    .prepare(
      `SELECT p.*, a.name, a.avatar, a.elo, a.wins, a.losses, a.draws,
              a.career_earnings, a.career_losses, a.games_played, a.type,
              a.share_price, a.total_shares_issued, a.management_fee_pct, a.peak_elo
      FROM portfolio p
      JOIN agents a ON p.agent_id = a.id
      WHERE p.user_id = ?
      ORDER BY (p.shares * a.share_price) DESC`
    )
    .all(userId);

  const recentDividends = db
    .prepare(
      `SELECT dp.amount, dp.shares, dp.created_at,
              a.name as agent_name, a.avatar as agent_avatar,
              d.game_type, d.total_prize
      FROM dividend_payouts dp
      JOIN dividends d ON dp.dividend_id = d.id
      JOIN agents a ON dp.agent_id = a.id
      WHERE dp.user_id = ?
      ORDER BY dp.created_at DESC
      LIMIT 20`
    )
    .all(userId);

  const recentEarnings = db
    .prepare(
      `SELECT ae.*, a.name as agent_name, a.avatar as agent_avatar
      FROM agent_earnings ae
      JOIN agents a ON ae.agent_id = a.id
      ORDER BY ae.created_at DESC
      LIMIT 30`
    )
    .all();

  const teams = db
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM agents a WHERE a.team_id = t.id) as member_count
      FROM teams t
      ORDER BY t.elo DESC`
    )
    .all();

  const recentGames = db
    .prepare(
      `SELECT g.id, g.game_type, g.result, g.prize_pool, g.finished_at,
        w.name as white_name, w.avatar as white_avatar, w.id as white_id,
        b.name as black_name, b.avatar as black_avatar, b.id as black_id
      FROM games g
      JOIN agents w ON g.white_id = w.id
      JOIN agents b ON g.black_id = b.id
      WHERE g.status = 'finished'
      ORDER BY g.finished_at DESC
      LIMIT 20`
    )
    .all();

  const bets = db
    .prepare(
      `SELECT b.*, a.name as agent_name, a.avatar as agent_avatar
      FROM bets b
      LEFT JOIN agents a ON b.agent_id = a.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT 20`
    )
    .all(userId);

  // Portfolio value based on share price
  const totalPortfolioValue = (portfolio as Array<{ shares: number; share_price: number }>).reduce(
    (sum, p) => sum + p.shares * p.share_price,
    0
  );

  const totalDividendsReceived = (portfolio as Array<{ dividends_received: number }>).reduce(
    (sum, p) => sum + p.dividends_received,
    0
  );

  const totalInvested = (portfolio as Array<{ invested: number }>).reduce(
    (sum, p) => sum + p.invested,
    0
  );

  return NextResponse.json({
    user,
    agents,
    portfolio,
    recentDividends,
    recentEarnings,
    teams,
    recentGames,
    bets,
    stats: {
      totalPortfolioValue,
      totalDividendsReceived,
      totalInvested,
      portfolioPnl: totalPortfolioValue - totalInvested + totalDividendsReceived,
      agentsOwned: portfolio.length,
      totalAgents: agents.length,
    },
  });
}
