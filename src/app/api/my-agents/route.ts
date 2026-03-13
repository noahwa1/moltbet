import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authUser = getCurrentUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Sign in to view your agents" }, { status: 401 });
  }
  const userId = authUser.id;
  const db = getDb();

  // Agents the user owns (registered)
  const ownedAgents = db
    .prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM games g WHERE (g.white_id = a.id OR g.black_id = a.id) AND g.status = 'live') as live_chess_games,
        (SELECT COALESCE(SUM(shares), 0) FROM portfolio WHERE agent_id = a.id) as total_held_shares
      FROM agents a
      WHERE a.owner_id = ? AND a.active = 1
      ORDER BY a.elo DESC`
    )
    .all(userId);

  // Agents the user has invested in (but doesn't own)
  const investments = db
    .prepare(
      `SELECT a.*, p.shares, p.invested, p.dividends_received,
        (SELECT COUNT(*) FROM games g WHERE (g.white_id = a.id OR g.black_id = a.id) AND g.status = 'live') as live_chess_games
      FROM portfolio p
      JOIN agents a ON p.agent_id = a.id
      WHERE p.user_id = ? AND a.owner_id != ? AND a.active = 1
      ORDER BY (p.shares * a.share_price) DESC`
    )
    .all(userId, userId);

  // Recent games for owned agents
  const ownedIds = (ownedAgents as Array<{ id: string }>).map((a) => a.id);
  let recentGames: unknown[] = [];
  if (ownedIds.length > 0) {
    const placeholders = ownedIds.map(() => "?").join(",");
    recentGames = db
      .prepare(
        `SELECT g.id, g.game_type, g.status, g.result, g.prize_pool, g.finished_at,
          w.name as white_name, w.avatar as white_avatar, w.id as white_id,
          b.name as black_name, b.avatar as black_avatar, b.id as black_id
        FROM games g
        JOIN agents w ON g.white_id = w.id
        JOIN agents b ON g.black_id = b.id
        WHERE (g.white_id IN (${placeholders}) OR g.black_id IN (${placeholders}))
        ORDER BY g.finished_at DESC
        LIMIT 20`
      )
      .all(...ownedIds, ...ownedIds);
  }

  // Earnings summary for owned agents
  let earningsSummary: unknown[] = [];
  if (ownedIds.length > 0) {
    const placeholders = ownedIds.map(() => "?").join(",");
    earningsSummary = db
      .prepare(
        `SELECT ae.agent_id, a.name, a.avatar,
          SUM(CASE WHEN ae.amount > 0 THEN ae.amount ELSE 0 END) as total_earned,
          SUM(CASE WHEN ae.amount < 0 THEN ae.amount ELSE 0 END) as total_lost,
          COUNT(*) as game_count
        FROM agent_earnings ae
        JOIN agents a ON ae.agent_id = a.id
        WHERE ae.agent_id IN (${placeholders})
        GROUP BY ae.agent_id
        ORDER BY total_earned DESC`
      )
      .all(...ownedIds);
  }

  return NextResponse.json({
    ownedAgents,
    investments,
    recentGames,
    earningsSummary,
  });
}
