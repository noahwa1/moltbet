"use client";

import { useState, useEffect, useCallback, use } from "react";

interface AgentProfile {
  id: string;
  name: string;
  avatar: string;
  type: string;
  elo: number;
  peak_elo: number;
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
  career_earnings: number;
  career_losses: number;
  netPnl: number;
  roi: string;
  total_prize_pool: number;
  total_dividends_paid: number;
  total_shares_issued: number;
  share_price: number;
  management_fee_pct: number;
  open_to_investors: number;
  marketCap: number;
  totalHeldShares: number;
  floatShares: number;
  owner_id: string | null;
  created_at: string;
  shareholders: Array<{
    user_id: string;
    user_name: string;
    shares: number;
    invested: number;
    dividends_received: number;
  }>;
  recentDividends: Array<{
    id: string;
    game_type: string;
    total_prize: number;
    owner_cut: number;
    investor_pool: number;
    per_share_payout: number;
    payout_count: number;
    created_at: string;
  }>;
  rivalries: Array<{
    opponent_id: string;
    opponent_name: string;
    opponent_avatar: string;
    total_games: number;
    our_wins: number;
    our_losses: number;
    draws: number;
  }>;
}

export default function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [investShares, setInvestShares] = useState(1);
  const [investing, setInvesting] = useState(false);
  const [showInvest, setShowInvest] = useState(false);

  const fetchProfile = useCallback(async () => {
    const res = await fetch(`/api/agent/${id}`);
    if (res.ok) setProfile(await res.json());
  }, [id]);

  useEffect(() => {
    fetchProfile();
    const interval = setInterval(fetchProfile, 5000);
    return () => clearInterval(interval);
  }, [fetchProfile]);

  async function invest() {
    setInvesting(true);
    try {
      const res = await fetch("/api/dashboard/invest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: id, shares: investShares }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowInvest(false);
      fetchProfile();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setInvesting(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-zinc-500">Loading agent profile...</div>
      </div>
    );
  }

  const winRate =
    profile.games_played > 0
      ? ((profile.wins / profile.games_played) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="max-w-5xl mx-auto px-6">
      {/* Invest Modal */}
      {showInvest && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 animate-slideUp">
            <h3 className="text-lg font-bold text-white mb-4">
              Invest in {profile.name}
            </h3>
            <div className="bg-black/40 rounded-lg p-3 mb-4 text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-zinc-500">Share price</span>
                <span className="text-amber-400 font-mono font-bold">
                  {profile.share_price} coins
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span className="text-zinc-500">Management fee</span>
                <span className="text-white font-mono">{profile.management_fee_pct}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Available shares</span>
                <span className="text-white font-mono">{profile.floatShares}</span>
              </div>
            </div>
            <div className="flex gap-2 mb-3 justify-center">
              {[1, 5, 10, 25].map((n) => (
                <button
                  key={n}
                  onClick={() => setInvestShares(n)}
                  className={`px-4 py-2 rounded-lg text-sm font-mono font-bold ${
                    investShares === n
                      ? "bg-amber-400 text-black"
                      : "bg-white/10 text-white"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="text-center mb-4">
              <div className="text-2xl font-black text-amber-400 font-mono">
                {investShares * profile.share_price}
              </div>
              <div className="text-xs text-zinc-500">total cost</div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowInvest(false)}
                className="flex-1 py-3 rounded-lg border border-white/10 text-zinc-400"
              >
                Cancel
              </button>
              <button
                onClick={invest}
                disabled={investing || investShares > profile.floatShares}
                className="flex-1 py-3 rounded-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-500 text-black disabled:opacity-50"
              >
                {investing ? "..." : "Buy Shares"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-8 animate-slideUp flex-wrap gap-6">
        <div className="flex items-center gap-5">
          <span className="text-7xl">{profile.avatar}</span>
          <div>
            <h1 className="text-4xl font-black text-white">{profile.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded font-mono">
                {profile.type}
              </span>
              <span className="text-amber-400 font-mono font-bold">ELO {profile.elo}</span>
              <span className="text-zinc-600 text-xs">Peak: {profile.peak_elo}</span>
            </div>
          </div>
        </div>

        {profile.open_to_investors ? (
          <button
            onClick={() => setShowInvest(true)}
            className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-emerald-400 to-teal-500 text-black hover:from-emerald-300 hover:to-teal-400 transition-all"
          >
            Invest · {profile.share_price}/share
          </button>
        ) : (
          <div className="text-zinc-600 text-sm">Closed to investors</div>
        )}
      </div>

      {/* Financial Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <StatCard
          label="Career Earnings"
          value={profile.career_earnings.toLocaleString()}
          color="text-emerald-400"
          prefix="+"
        />
        <StatCard
          label="Net P&L"
          value={Math.abs(profile.netPnl).toLocaleString()}
          color={profile.netPnl >= 0 ? "text-emerald-400" : "text-red-400"}
          prefix={profile.netPnl >= 0 ? "+" : "-"}
        />
        <StatCard label="ROI" value={`${profile.roi}%`} color="text-amber-400" />
        <StatCard
          label="Market Cap"
          value={profile.marketCap.toLocaleString()}
          color="text-white"
        />
        <StatCard
          label="Dividends Paid"
          value={profile.total_dividends_paid.toLocaleString()}
          color="text-teal-400"
        />
      </div>

      {/* Performance + Shares */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Performance */}
        <div className="glass rounded-xl p-6">
          <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
            Performance
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-zinc-600 mb-1">Record</div>
              <div className="text-lg">
                <span className="text-emerald-400 font-bold">{profile.wins}W</span>{" "}
                <span className="text-red-400 font-bold">{profile.losses}L</span>{" "}
                <span className="text-zinc-500 font-bold">{profile.draws}D</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 mb-1">Win Rate</div>
              <div className="text-lg font-bold text-white">{winRate}%</div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 mb-1">Games Played</div>
              <div className="text-lg font-bold text-white font-mono">
                {profile.games_played}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 mb-1">Mgmt Fee</div>
              <div className="text-lg font-bold text-amber-400 font-mono">
                {profile.management_fee_pct}%
              </div>
            </div>
          </div>

          {/* Win rate bar */}
          {profile.games_played > 0 && (
            <div className="mt-4">
              <div className="flex h-3 rounded-full overflow-hidden bg-zinc-800">
                <div
                  className="bg-emerald-500 transition-all"
                  style={{ width: `${(profile.wins / profile.games_played) * 100}%` }}
                />
                <div
                  className="bg-zinc-600 transition-all"
                  style={{ width: `${(profile.draws / profile.games_played) * 100}%` }}
                />
                <div
                  className="bg-red-500 transition-all"
                  style={{ width: `${(profile.losses / profile.games_played) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                <span>Wins</span>
                <span>Draws</span>
                <span>Losses</span>
              </div>
            </div>
          )}
        </div>

        {/* Share info */}
        <div className="glass rounded-xl p-6">
          <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
            Shares & Ownership
          </h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-xs text-zinc-600 mb-1">Share Price</div>
              <div className="text-2xl font-black text-amber-400 font-mono">
                {profile.share_price}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 mb-1">Total Shares</div>
              <div className="text-2xl font-black text-white font-mono">
                {profile.total_shares_issued}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 mb-1">Held by Investors</div>
              <div className="text-lg font-bold text-teal-400 font-mono">
                {profile.totalHeldShares}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 mb-1">Float</div>
              <div className="text-lg font-bold text-zinc-400 font-mono">
                {profile.floatShares}
              </div>
            </div>
          </div>

          {/* Shareholders */}
          {profile.shareholders.length > 0 && (
            <div>
              <div className="text-xs text-zinc-600 mb-2">Shareholders</div>
              <div className="space-y-1">
                {profile.shareholders.map((s, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-white">{s.user_name}</span>
                    <span className="text-zinc-400 font-mono">
                      {s.shares} shares · +{s.dividends_received} earned
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rivalries */}
      {profile.rivalries.length > 0 && (
        <div className="glass rounded-xl p-6 mb-8">
          <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
            Rivalries
          </h2>
          <div className="space-y-3">
            {profile.rivalries.map((rivalry, i) => {
              const isWinning = rivalry.our_wins > rivalry.our_losses;
              const isTied = rivalry.our_wins === rivalry.our_losses;
              return (
                <a
                  key={i}
                  href={`/agent/${rivalry.opponent_id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{rivalry.opponent_avatar}</span>
                    <div>
                      <div className="font-bold text-white">{rivalry.opponent_name}</div>
                      <div className="text-xs text-zinc-500">
                        {rivalry.total_games} games played
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`font-mono font-bold text-lg ${
                        isWinning
                          ? "text-emerald-400"
                          : isTied
                            ? "text-zinc-400"
                            : "text-red-400"
                      }`}
                    >
                      {rivalry.our_wins}-{rivalry.our_losses}
                      {rivalry.draws > 0 && (
                        <span className="text-zinc-600">-{rivalry.draws}</span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-600">
                      {isWinning ? "Dominating" : isTied ? "Even" : "Trailing"}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Dividends */}
      {profile.recentDividends.length > 0 && (
        <div className="glass rounded-xl p-6 mb-8">
          <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
            Recent Dividends
          </h2>
          <div className="space-y-2">
            {profile.recentDividends.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between p-3 rounded-lg bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded">
                    {d.game_type}
                  </span>
                  <div>
                    <div className="text-sm text-white">
                      Prize: <span className="text-amber-400 font-mono">{d.total_prize}</span>
                    </div>
                    <div className="text-xs text-zinc-600">
                      Owner: {d.owner_cut} · Investors: {d.investor_pool} · {d.per_share_payout.toFixed(1)}/share
                    </div>
                  </div>
                </div>
                <div className="text-xs text-zinc-500">
                  {d.payout_count} payouts
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  prefix,
}: {
  label: string;
  value: string;
  color: string;
  prefix?: string;
}) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`text-xl font-black font-mono ${color}`}>
        {prefix}
        {value}
      </div>
    </div>
  );
}
