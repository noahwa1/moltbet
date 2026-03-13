import { getDb } from "./db";
import { v4 as uuid } from "uuid";

/**
 * When an agent wins a game, distribute prize money:
 * 1. Owner takes management_fee_pct
 * 2. Rest goes to shareholders proportional to their shares
 * 3. Agent's career_earnings and share_price update
 */
export function distributeWinnings(
  agentId: string,
  gameId: string,
  gameType: string,
  prizeAmount: number
) {
  const db = getDb();

  const agent = db
    .prepare(
      "SELECT id, owner_id, management_fee_pct, total_shares_issued, career_earnings, share_price, peak_elo, elo FROM agents WHERE id = ?"
    )
    .get(agentId) as {
    id: string;
    owner_id: string | null;
    management_fee_pct: number;
    total_shares_issued: number;
    career_earnings: number;
    share_price: number;
    peak_elo: number;
    elo: number;
  };

  if (!agent) return;

  // Record the earning
  db.prepare(
    "INSERT INTO agent_earnings (id, agent_id, game_id, game_type, amount, result) VALUES (?, ?, ?, ?, ?, 'win')"
  ).run(uuid(), agentId, gameId, gameType, prizeAmount);

  // Update agent career stats
  const newCareerEarnings = agent.career_earnings + prizeAmount;
  const newPeakElo = Math.max(agent.peak_elo, agent.elo);

  // Recalculate share price: base 100 + (career_earnings / 100) + (elo - 1000) * 0.5
  const newSharePrice = Math.max(
    10,
    Math.round(100 + newCareerEarnings / 100 + (agent.elo - 1000) * 0.5)
  );

  db.prepare(
    "UPDATE agents SET career_earnings = ?, total_prize_pool = total_prize_pool + ?, share_price = ?, peak_elo = ? WHERE id = ?"
  ).run(newCareerEarnings, prizeAmount, newSharePrice, newPeakElo, agentId);

  // Get all shareholders
  const shareholders = db
    .prepare("SELECT user_id, shares FROM portfolio WHERE agent_id = ?")
    .all(agentId) as { user_id: string; shares: number }[];

  const totalHeldShares = shareholders.reduce((sum, s) => sum + s.shares, 0);

  if (totalHeldShares === 0 && !agent.owner_id) {
    // No investors, no owner — prize just goes to agent career earnings
    return;
  }

  // Calculate cuts
  const ownerCut = Math.round(prizeAmount * (agent.management_fee_pct / 100));
  const investorPool = prizeAmount - ownerCut;

  // Record the dividend event
  const dividendId = uuid();
  const perSharePayout =
    totalHeldShares > 0 ? investorPool / totalHeldShares : 0;

  db.prepare(
    "INSERT INTO dividends (id, agent_id, game_id, game_type, total_prize, owner_cut, investor_pool, per_share_payout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    dividendId,
    agentId,
    gameId,
    gameType,
    prizeAmount,
    ownerCut,
    investorPool,
    perSharePayout
  );

  // Pay the owner
  if (agent.owner_id) {
    db.prepare(
      "UPDATE users SET balance = balance + ?, total_dividends = total_dividends + ? WHERE id = ?"
    ).run(ownerCut, ownerCut, agent.owner_id);
  }

  // Pay each shareholder
  if (totalHeldShares > 0 && investorPool > 0) {
    const payStmt = db.prepare(
      "INSERT INTO dividend_payouts (id, dividend_id, user_id, agent_id, shares, amount) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const updateBalance = db.prepare(
      "UPDATE users SET balance = balance + ?, total_dividends = total_dividends + ? WHERE id = ?"
    );
    const updatePortfolio = db.prepare(
      "UPDATE portfolio SET dividends_received = dividends_received + ? WHERE user_id = ? AND agent_id = ?"
    );

    for (const holder of shareholders) {
      const payout = Math.round(perSharePayout * holder.shares);
      if (payout <= 0) continue;

      payStmt.run(
        uuid(),
        dividendId,
        holder.user_id,
        agentId,
        holder.shares,
        payout
      );
      updateBalance.run(payout, payout, holder.user_id);
      updatePortfolio.run(payout, holder.user_id, agentId);
    }

    db.prepare(
      "UPDATE agents SET total_dividends_paid = total_dividends_paid + ? WHERE id = ?"
    ).run(investorPool, agentId);
  }
}

/**
 * Record a loss for an agent (affects share price)
 */
export function recordLoss(
  agentId: string,
  gameId: string,
  gameType: string,
  lossAmount: number
) {
  const db = getDb();

  db.prepare(
    "INSERT INTO agent_earnings (id, agent_id, game_id, game_type, amount, result) VALUES (?, ?, ?, ?, ?, 'loss')"
  ).run(uuid(), agentId, gameId, gameType, -lossAmount);

  db.prepare(
    "UPDATE agents SET career_losses = career_losses + ? WHERE id = ?"
  ).run(lossAmount, agentId);

  // Recalculate share price
  const agent = db
    .prepare("SELECT career_earnings, career_losses, elo FROM agents WHERE id = ?")
    .get(agentId) as { career_earnings: number; career_losses: number; elo: number };

  const netEarnings = agent.career_earnings - agent.career_losses;
  const newSharePrice = Math.max(
    10,
    Math.round(100 + netEarnings / 100 + (agent.elo - 1000) * 0.5)
  );

  db.prepare("UPDATE agents SET share_price = ? WHERE id = ?").run(
    newSharePrice,
    agentId
  );
}

/**
 * Get full financial profile for an agent
 */
export function getAgentFinancials(agentId: string) {
  const db = getDb();

  const agent = db
    .prepare(
      `SELECT id, name, avatar, elo, peak_elo, wins, losses, draws, games_played,
              career_earnings, career_losses, total_prize_pool, total_dividends_paid,
              total_shares_issued, share_price, management_fee_pct, open_to_investors,
              owner_id, type, created_at
       FROM agents WHERE id = ?`
    )
    .get(agentId) as Record<string, unknown> | undefined;

  if (!agent) return null;

  const careerEarnings = agent.career_earnings as number;
  const careerLosses = agent.career_losses as number;
  const netPnl = careerEarnings - careerLosses;
  const gamesPlayed = agent.games_played as number;
  const roi =
    gamesPlayed > 0
      ? ((netPnl / (gamesPlayed * 500)) * 100).toFixed(1) // Assuming avg 500 prize pool
      : "0.0";

  // Shareholders
  const shareholders = db
    .prepare(
      `SELECT p.user_id, p.shares, p.invested, p.dividends_received, u.name as user_name
       FROM portfolio p
       JOIN users u ON p.user_id = u.id
       WHERE p.agent_id = ?
       ORDER BY p.shares DESC`
    )
    .all(agentId);

  const totalHeldShares = (shareholders as Array<{ shares: number }>).reduce(
    (sum, s) => sum + s.shares,
    0
  );

  // Recent dividends
  const recentDividends = db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM dividend_payouts dp WHERE dp.dividend_id = d.id) as payout_count
       FROM dividends d
       WHERE d.agent_id = ?
       ORDER BY d.created_at DESC LIMIT 10`
    )
    .all(agentId);

  // Head-to-head records (rivalries)
  const rivalries = db
    .prepare(
      `SELECT
        opponent_id,
        opp.name as opponent_name,
        opp.avatar as opponent_avatar,
        COUNT(*) as total_games,
        SUM(CASE WHEN winner = ? THEN 1 ELSE 0 END) as our_wins,
        SUM(CASE WHEN winner != ? AND winner IS NOT NULL THEN 1 ELSE 0 END) as our_losses,
        SUM(CASE WHEN winner IS NULL THEN 1 ELSE 0 END) as draws
      FROM (
        SELECT
          CASE WHEN white_id = ? THEN black_id ELSE white_id END as opponent_id,
          CASE
            WHEN result = '1-0' THEN white_id
            WHEN result = '0-1' THEN black_id
            ELSE NULL
          END as winner
        FROM games
        WHERE (white_id = ? OR black_id = ?) AND status = 'finished'
      ) matchups
      JOIN agents opp ON opp.id = opponent_id
      GROUP BY opponent_id
      ORDER BY total_games DESC
      LIMIT 10`
    )
    .all(agentId, agentId, agentId, agentId, agentId);

  // Market cap
  const marketCap =
    (agent.share_price as number) * (agent.total_shares_issued as number);

  return {
    ...agent,
    netPnl,
    roi,
    marketCap,
    totalHeldShares,
    floatShares:
      (agent.total_shares_issued as number) - totalHeldShares,
    shareholders,
    recentDividends,
    rivalries,
  };
}
