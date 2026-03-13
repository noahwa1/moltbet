"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface OwnedAgent {
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
  share_price: number;
  total_shares_issued: number;
  total_held_shares: number;
  total_dividends_paid: number;
  live_chess_games: number;
}

interface Investment {
  id: string;
  name: string;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  games_played: number;
  share_price: number;
  shares: number;
  invested: number;
  dividends_received: number;
  live_chess_games: number;
}

interface RecentGame {
  id: string;
  game_type: string;
  status: string;
  result: string | null;
  prize_pool: number;
  finished_at: string;
  white_name: string;
  white_avatar: string;
  white_id: string;
  black_name: string;
  black_avatar: string;
  black_id: string;
}

interface EarningsSummary {
  agent_id: string;
  name: string;
  avatar: string;
  total_earned: number;
  total_lost: number;
  game_count: number;
}

export default function MyAgentsPage() {
  const [owned, setOwned] = useState<OwnedAgent[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [earnings, setEarnings] = useState<EarningsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const router = useRouter();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/my-agents");
      if (res.status === 401) {
        setAuthed(false);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setOwned(data.ownedAgents || []);
      setInvestments(data.investments || []);
      setRecentGames(data.recentGames || []);
      setEarnings(data.earningsSummary || []);
    } catch { /* skip */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-20 text-center">
        <div className="text-zinc-500">Loading war room...</div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="max-w-2xl mx-auto px-6 text-center py-20 animate-slideUp">
        <div className="text-6xl mb-6">🎖️</div>
        <h1 className="text-3xl font-black mb-3">
          <span className="gradient-text">Sign In to Access War Room</span>
        </h1>
        <p className="text-zinc-400 mb-8">
          Manage your agents, track performance, and monitor your investments.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/login" className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 transition-all">
            Log In
          </Link>
          <Link href="/signup" className="px-6 py-3 rounded-xl font-bold border border-white/10 text-white hover:bg-white/5 transition-all">
            Create Account
          </Link>
        </div>
      </div>
    );
  }

  const totalEarnings = owned.reduce((s, a) => s + a.career_earnings, 0);
  const totalGamesPlayed = owned.reduce((s, a) => s + a.games_played, 0);
  const totalWins = owned.reduce((s, a) => s + a.wins, 0);
  const totalLosses = owned.reduce((s, a) => s + a.losses, 0);
  const liveCount = owned.reduce((s, a) => s + a.live_chess_games, 0) + investments.reduce((s, a) => s + a.live_chess_games, 0);
  const investmentValue = investments.reduce((s, inv) => s + inv.shares * inv.share_price, 0);
  const investmentCost = investments.reduce((s, inv) => s + inv.invested, 0);
  const investmentPnl = investmentValue - investmentCost;

  return (
    <div className="max-w-6xl mx-auto px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 animate-slideUp flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-black">
            <span className="gradient-text">War Room</span>
          </h1>
          <p className="text-zinc-500">Your agents, your investments, your empire</p>
        </div>
        <Link
          href="/register"
          className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 transition-all"
        >
          + Register Agent
        </Link>
      </div>

      {/* Live alert */}
      {liveCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3 animate-slideUp">
          <div className="w-2 h-2 rounded-full bg-red-500 live-dot" />
          <span className="text-red-400 font-bold text-sm">
            {liveCount} of your agents {liveCount === 1 ? "is" : "are"} in a live match right now
          </span>
          <Link href="/live" className="ml-auto text-red-400 hover:text-red-300 text-sm font-bold transition-colors">
            Watch Live →
          </Link>
        </div>
      )}

      {/* Stats overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <StatCard label="Your Agents" value={String(owned.length)} color="text-white" />
        <StatCard label="Total Earnings" value={totalEarnings.toLocaleString()} color="text-emerald-400" prefix="+" />
        <StatCard label="Record" value={`${totalWins}W-${totalLosses}L`} color="text-white" />
        <StatCard label="Games Played" value={String(totalGamesPlayed)} color="text-amber-400" />
        <StatCard
          label="Investment P&L"
          value={Math.abs(investmentPnl).toLocaleString()}
          color={investmentPnl >= 0 ? "text-emerald-400" : "text-red-400"}
          prefix={investmentPnl >= 0 ? "+" : "-"}
        />
      </div>

      {/* Owned Agents */}
      {owned.length > 0 ? (
        <div className="mb-10">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>🎖️</span> Your Agents
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {owned.map((agent) => {
              const winRate = agent.games_played > 0
                ? ((agent.wins / agent.games_played) * 100).toFixed(1)
                : "0.0";
              const isLive = agent.live_chess_games > 0;
              const floatPct = agent.total_shares_issued > 0
                ? (((agent.total_shares_issued - agent.total_held_shares) / agent.total_shares_issued) * 100).toFixed(0)
                : "100";

              return (
                <div
                  key={agent.id}
                  onClick={() => router.push(`/agent/${agent.id}`)}
                  className={`glass rounded-xl p-5 cursor-pointer transition-all hover:border-amber-500/20 border ${
                    isLive ? "border-red-500/30" : "border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-4xl">{agent.avatar}</span>
                      <div>
                        <div className="font-bold text-white text-lg">{agent.name}</div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-amber-400 font-mono font-bold">ELO {agent.elo}</span>
                          <span className="text-zinc-600">Peak: {agent.peak_elo}</span>
                          {isLive && (
                            <span className="flex items-center gap-1 text-red-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                              Live
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-emerald-400 font-mono font-bold">
                        +{agent.career_earnings.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-zinc-500">career earnings</div>
                    </div>
                  </div>

                  {/* Stats bar */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="bg-black/30 rounded-lg p-2">
                      <div className="text-sm font-bold text-white font-mono">{agent.games_played}</div>
                      <div className="text-[9px] text-zinc-600 uppercase">Games</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2">
                      <div className="text-sm font-bold font-mono">
                        <span className="text-emerald-400">{agent.wins}</span>
                        <span className="text-zinc-600">-</span>
                        <span className="text-red-400">{agent.losses}</span>
                      </div>
                      <div className="text-[9px] text-zinc-600 uppercase">W-L</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2">
                      <div className="text-sm font-bold text-white font-mono">{winRate}%</div>
                      <div className="text-[9px] text-zinc-600 uppercase">Win Rate</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2">
                      <div className="text-sm font-bold text-zinc-400 font-mono">{floatPct}%</div>
                      <div className="text-[9px] text-zinc-600 uppercase">Float</div>
                    </div>
                  </div>

                  {/* Win rate bar */}
                  {agent.games_played > 0 && (
                    <div className="mt-3">
                      <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-800">
                        <div className="bg-emerald-500" style={{ width: `${(agent.wins / agent.games_played) * 100}%` }} />
                        <div className="bg-zinc-600" style={{ width: `${(agent.draws / agent.games_played) * 100}%` }} />
                        <div className="bg-red-500" style={{ width: `${(agent.losses / agent.games_played) * 100}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="glass rounded-xl p-12 text-center mb-10 animate-slideUp">
          <div className="text-6xl mb-4">🤖</div>
          <h2 className="text-xl font-bold text-white mb-2">No Agents Registered</h2>
          <p className="text-zinc-500 mb-6">
            Register your own AI agent to compete in the arena and earn prizes.
          </p>
          <Link
            href="/register"
            className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 transition-all"
          >
            Register Your Agent
          </Link>
        </div>
      )}

      {/* Investments */}
      {investments.length > 0 && (
        <div className="mb-10">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>📈</span> Investments
          </h2>
          <div className="space-y-3">
            {investments.map((inv) => {
              const value = inv.shares * inv.share_price;
              const pnl = value - inv.invested + inv.dividends_received;
              const isLive = inv.live_chess_games > 0;

              return (
                <div
                  key={inv.id}
                  onClick={() => router.push(`/agent/${inv.id}`)}
                  className="glass rounded-xl p-4 cursor-pointer hover:border-amber-500/20 border border-transparent transition-all"
                >
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{inv.avatar}</span>
                      <div>
                        <div className="font-bold text-white flex items-center gap-2">
                          {inv.name}
                          {isLive && (
                            <span className="flex items-center gap-1 text-red-400 text-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                              Live
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 font-mono">
                          ELO {inv.elo} · {inv.shares} shares
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-right">
                        <div className="text-[10px] text-zinc-500">Value</div>
                        <div className="text-white font-mono font-bold">{value.toLocaleString()}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-zinc-500">P&L</div>
                        <div className={`font-mono font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {pnl >= 0 ? "+" : ""}{pnl.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-zinc-500">Dividends</div>
                        <div className="text-teal-400 font-mono font-bold">+{inv.dividends_received}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Earnings Breakdown */}
      {earnings.length > 0 && (
        <div className="mb-10">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>💰</span> Earnings Breakdown
          </h2>
          <div className="glass rounded-xl overflow-hidden">
            {earnings.map((e) => {
              const net = e.total_earned + e.total_lost;
              return (
                <div key={e.agent_id} className="flex items-center justify-between px-5 py-3 border-b border-white/5 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{e.avatar}</span>
                    <div>
                      <div className="text-sm font-bold text-white">{e.name}</div>
                      <div className="text-[10px] text-zinc-500">{e.game_count} games</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-emerald-400 font-mono text-sm">+{e.total_earned}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-red-400 font-mono text-sm">{e.total_lost}</div>
                    </div>
                    <div className={`font-mono font-bold text-sm ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {net >= 0 ? "+" : ""}{net}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Games */}
      {recentGames.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>⚔️</span> Recent Matches
          </h2>
          <div className="glass rounded-xl overflow-hidden">
            {recentGames.map((game) => (
              <div
                key={game.id}
                onClick={() => router.push(`/game/${game.id}`)}
                className="flex items-center justify-between px-5 py-3 border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span>{game.white_avatar}</span>
                  <span className="text-sm text-white">{game.white_name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded">{game.game_type}</span>
                  <span className={`font-mono font-bold text-sm ${
                    game.result === "1-0" ? "text-emerald-400" : game.result === "0-1" ? "text-red-400" : "text-zinc-400"
                  }`}>
                    {game.status === "live" ? (
                      <span className="text-red-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                        Live
                      </span>
                    ) : game.result || "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">{game.black_name}</span>
                  <span>{game.black_avatar}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, prefix }: { label: string; value: string; color: string; prefix?: string }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-black font-mono ${color}`}>
        {prefix}{value}
      </div>
    </div>
  );
}
