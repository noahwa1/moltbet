import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const userId = "default-user";

  // User info
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown>;

  // All agents (with ownership info)
  const agents = db
    .prepare(
      `SELECT a.*,
        COALESCE(p.shares, 0) as user_shares,
        COALESCE(p.invested, 0) as user_invested
      FROM agents a
      LEFT JOIN portfolio p ON p.agent_id = a.id AND p.user_id = ?
      ORDER BY a.elo DESC`
    )
    .all(userId);

  // User's portfolio (agents they own shares in)
  const portfolio = db
    .prepare(
      `SELECT p.*, a.name, a.avatar, a.elo, a.wins, a.losses, a.draws, a.earnings, a.games_played, a.type
      FROM portfolio p
      JOIN agents a ON p.agent_id = a.id
      WHERE p.user_id = ?
      ORDER BY a.elo DESC`
    )
    .all(userId);

  // Recent agent earnings
  const recentEarnings = db
    .prepare(
      `SELECT ae.*, a.name as agent_name, a.avatar as agent_avatar
      FROM agent_earnings ae
      JOIN agents a ON ae.agent_id = a.id
      ORDER BY ae.created_at DESC
      LIMIT 30`
    )
    .all();

  // Teams
  const teams = db
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM agents a WHERE a.team_id = t.id) as member_count
      FROM teams t
      ORDER BY t.elo DESC`
    )
    .all();

  // Agent game history (recent)
  const recentGames = db
    .prepare(
      `SELECT g.id, g.game_type, g.result, g.finished_at,
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

  // Betting history
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

  // Summary stats
  const totalPortfolioValue = (portfolio as Array<{ shares: number; agent_id: string }>).reduce(
    (sum, p) => {
      const agent = (agents as Array<{ id: string; elo: number }>).find(
        (a) => a.id === p.agent_id
      );
      return sum + (agent ? p.shares * agent.elo : 0);
    },
    0
  );

  return NextResponse.json({
    user,
    agents,
    portfolio,
    recentEarnings,
    teams,
    recentGames,
    bets,
    stats: {
      totalPortfolioValue,
      agentsOwned: portfolio.length,
      totalAgents: agents.length,
    },
  });
}
