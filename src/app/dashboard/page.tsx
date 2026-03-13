"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/components/AuthPrompt";

interface Agent {
  id: string;
  name: string;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  type: string;
  earnings: number;
  games_played: number;
  team_id: string | null;
  user_shares: number;
  user_invested: number;
}

interface PortfolioItem {
  agent_id: string;
  name: string;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  earnings: number;
  games_played: number;
  shares: number;
  invested: number;
  bought_at_elo: number;
  type: string;
}

interface Team {
  id: string;
  name: string;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  member_count: number;
}

interface EarningEntry {
  agent_name: string;
  agent_avatar: string;
  game_type: string;
  amount: number;
  result: string;
  created_at: string;
}

interface DashboardData {
  user: { balance: number; total_won: number; total_lost: number };
  agents: Agent[];
  portfolio: PortfolioItem[];
  recentEarnings: EarningEntry[];
  teams: Team[];
  recentGames: Array<{
    id: string;
    game_type: string;
    result: string;
    white_name: string;
    white_avatar: string;
    white_id: string;
    black_name: string;
    black_avatar: string;
    black_id: string;
  }>;
  bets: Array<{
    id: string;
    agent_name: string;
    agent_avatar: string;
    amount: number;
    odds: number;
    status: string;
    payout: number;
  }>;
  stats: {
    totalPortfolioValue: number;
    agentsOwned: number;
    totalAgents: number;
  };
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [tab, setTab] = useState<"portfolio" | "agents" | "teams" | "history">("portfolio");
  const [investModal, setInvestModal] = useState<Agent | null>(null);
  const [investShares, setInvestShares] = useState(1);
  const [investing, setInvesting] = useState(false);
  const [teamModal, setTeamModal] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamAvatar, setTeamAvatar] = useState("⚔️");
  const [teamAgents, setTeamAgents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/dashboard");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function invest() {
    if (!investModal) return;
    setInvesting(true);
    try {
      const res = await authFetch("/api/dashboard/invest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: investModal.id, shares: investShares }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setInvestModal(null);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setInvesting(false);
    }
  }

  async function createTeam() {
    if (!teamName || teamAgents.length < 2) return;
    setCreating(true);
    try {
      const res = await authFetch("/api/dashboard/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName, avatar: teamAvatar, agentIds: teamAgents }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setTeamModal(false);
      setTeamName("");
      setTeamAgents([]);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-zinc-500">Loading dashboard...</div>
      </div>
    );
  }

  const balance = data.user.balance;

  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Invest Modal */}
      {investModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 animate-slideUp">
            <div className="text-center mb-4">
              <span className="text-5xl">{investModal.avatar}</span>
              <h3 className="text-xl font-bold text-white mt-2">{investModal.name}</h3>
              <div className="text-amber-400 font-mono">ELO {investModal.elo}</div>
            </div>

            <div className="bg-black/40 rounded-lg p-3 mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-zinc-500">Price per share</span>
                <span className="text-white font-mono">{investModal.elo} coins</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-zinc-500">Win rate</span>
                <span className="text-white font-mono">
                  {investModal.games_played > 0
                    ? ((investModal.wins / investModal.games_played) * 100).toFixed(0) + "%"
                    : "N/A"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Earnings</span>
                <span className="text-emerald-400 font-mono">{investModal.earnings}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-2 block">
                Shares
              </label>
              <div className="flex gap-2 mb-2">
                {[1, 2, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setInvestShares(n)}
                    className={`flex-1 py-2 rounded-lg text-sm font-mono font-bold transition-all ${
                      investShares === n
                        ? "bg-amber-400 text-black"
                        : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="text-center text-lg font-bold text-amber-400 font-mono">
                Total: {investShares * investModal.elo} coins
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setInvestModal(null)}
                className="flex-1 py-3 rounded-lg border border-white/10 text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={invest}
                disabled={investing || balance < investShares * investModal.elo}
                className="flex-1 py-3 rounded-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-500 text-black disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {investing ? "..." : "Invest"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Team Creation Modal */}
      {teamModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4 animate-slideUp">
            <h3 className="text-xl font-bold text-white mb-4">Create Team</h3>

            <div className="mb-4">
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-2 block">
                Team Name
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Team Chaos"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-amber-400/50 focus:outline-none"
              />
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-2 block">
                Avatar
              </label>
              <div className="flex gap-2 flex-wrap">
                {["⚔️", "🏴", "🔥", "💀", "🐉", "🦅", "🌀", "💎"].map((a) => (
                  <button
                    key={a}
                    onClick={() => setTeamAvatar(a)}
                    className={`text-2xl p-2 rounded-lg ${
                      teamAvatar === a
                        ? "bg-amber-400/20 border-2 border-amber-400"
                        : "bg-white/5 border-2 border-transparent"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-2 block">
                Select Agents (2-4, must own shares)
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {data.portfolio.map((p) => (
                  <button
                    key={p.agent_id}
                    onClick={() => {
                      setTeamAgents((prev) =>
                        prev.includes(p.agent_id)
                          ? prev.filter((id) => id !== p.agent_id)
                          : prev.length < 4
                            ? [...prev, p.agent_id]
                            : prev
                      );
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                      teamAgents.includes(p.agent_id)
                        ? "bg-emerald-400/10 border border-emerald-400/30"
                        : "bg-white/5 border border-transparent hover:bg-white/10"
                    }`}
                  >
                    <span className="text-xl">{p.avatar}</span>
                    <span className="font-bold text-white text-sm">{p.name}</span>
                    <span className="text-xs text-zinc-500 ml-auto">ELO {p.elo}</span>
                    {teamAgents.includes(p.agent_id) && (
                      <span className="text-emerald-400">✓</span>
                    )}
                  </button>
                ))}
                {data.portfolio.length === 0 && (
                  <div className="text-zinc-600 text-sm text-center py-4">
                    You need to invest in agents first to form a team
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setTeamModal(false)}
                className="flex-1 py-3 rounded-lg border border-white/10 text-zinc-400"
              >
                Cancel
              </button>
              <button
                onClick={createTeam}
                disabled={creating || teamAgents.length < 2 || !teamName}
                className="flex-1 py-3 rounded-lg font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {creating ? "..." : "Create Team"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8 animate-slideUp">
        <h1 className="text-4xl font-black mb-2">
          <span className="gradient-text">Dashboard</span>
        </h1>
        <p className="text-zinc-500">Manage your agents, teams, and investments</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="glass rounded-xl p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Balance</div>
          <div className="text-2xl font-black text-amber-400 font-mono">
            {balance.toLocaleString()}
          </div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Portfolio Value</div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {data.stats.totalPortfolioValue.toLocaleString()}
          </div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Agents Owned</div>
          <div className="text-2xl font-black text-white font-mono">
            {data.stats.agentsOwned}
            <span className="text-sm text-zinc-500">/{data.stats.totalAgents}</span>
          </div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Teams</div>
          <div className="text-2xl font-black text-white font-mono">{data.teams.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1 w-fit">
        {(["portfolio", "agents", "teams", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-md text-sm font-bold transition-all capitalize ${
              tab === t
                ? "bg-white/10 text-white"
                : "text-zinc-500 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Portfolio Tab */}
      {tab === "portfolio" && (
        <div>
          {data.portfolio.length === 0 ? (
            <div className="glass rounded-xl p-12 text-center">
              <div className="text-4xl mb-3">📊</div>
              <h3 className="text-xl font-bold text-white mb-2">No Investments Yet</h3>
              <p className="text-zinc-500 mb-4">
                Invest in agents to earn when they win. Go to the Agents tab to buy shares.
              </p>
              <button
                onClick={() => setTab("agents")}
                className="px-6 py-2 rounded-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-500 text-black"
              >
                Browse Agents
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {data.portfolio.map((p) => {
                const currentValue = p.shares * p.elo;
                const pnl = currentValue - p.invested;
                const pnlPercent = p.invested > 0 ? ((pnl / p.invested) * 100).toFixed(1) : "0";
                const totalGames = p.wins + p.losses + p.draws;
                const winRate = totalGames > 0 ? ((p.wins / totalGames) * 100).toFixed(0) : "—";

                return (
                  <div key={p.agent_id} className="glass rounded-xl p-5">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div className="flex items-center gap-4">
                        <span className="text-4xl">{p.avatar}</span>
                        <div>
                          <div className="font-bold text-white text-lg">{p.name}</div>
                          <div className="flex items-center gap-3 text-xs text-zinc-500">
                            <span className="font-mono">ELO {p.elo}</span>
                            <span>{p.type === "external" ? "🌐 External" : "🤖 Builtin"}</span>
                            <span>{p.shares} shares</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="text-xs text-zinc-500">Value</div>
                          <div className="font-mono font-bold text-white">
                            {currentValue.toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-zinc-500">P&L</div>
                          <div
                            className={`font-mono font-bold ${
                              pnl >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {pnl >= 0 ? "+" : ""}
                            {pnl} ({pnlPercent}%)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-zinc-500">Win Rate</div>
                          <div className="font-mono font-bold text-white">
                            {winRate}{winRate !== "—" && "%"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-zinc-500">Record</div>
                          <div className="text-sm">
                            <span className="text-emerald-400">{p.wins}W</span>{" "}
                            <span className="text-red-400">{p.losses}L</span>{" "}
                            <span className="text-zinc-500">{p.draws}D</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recent Earnings */}
          {data.recentEarnings.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">
                Recent Agent Earnings
              </h3>
              <div className="glass rounded-xl overflow-hidden">
                {data.recentEarnings.slice(0, 10).map((e, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3 border-b border-white/5 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span>{e.agent_avatar}</span>
                      <span className="font-bold text-white text-sm">{e.agent_name}</span>
                      <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded">
                        {e.game_type}
                      </span>
                    </div>
                    <div className={`font-mono font-bold text-sm ${e.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {e.amount >= 0 ? "+" : ""}{e.amount}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agents Tab - Browse & Invest */}
      {tab === "agents" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.agents.map((agent) => {
            const totalGames = agent.wins + agent.losses + agent.draws;
            const winRate = totalGames > 0 ? ((agent.wins / totalGames) * 100).toFixed(0) : "—";

            return (
              <div key={agent.id} className="glass rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-4xl">{agent.avatar}</span>
                  <div>
                    <div className="font-bold text-white">{agent.name}</div>
                    <div className="text-xs text-zinc-500">
                      {agent.type === "external" ? "🌐 External" : "🤖 Builtin"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <div className="bg-black/30 rounded-lg p-2">
                    <div className="text-lg font-bold text-amber-400 font-mono">{agent.elo}</div>
                    <div className="text-[10px] text-zinc-500 uppercase">ELO</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2">
                    <div className="text-lg font-bold text-white font-mono">
                      {winRate}{winRate !== "—" && <span className="text-xs">%</span>}
                    </div>
                    <div className="text-[10px] text-zinc-500 uppercase">Win Rate</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2">
                    <div className="text-lg font-bold text-emerald-400 font-mono">{agent.earnings}</div>
                    <div className="text-[10px] text-zinc-500 uppercase">Earnings</div>
                  </div>
                </div>

                {agent.user_shares > 0 && (
                  <div className="bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2 mb-3 text-sm">
                    <span className="text-emerald-400 font-bold">{agent.user_shares} shares</span>
                    <span className="text-zinc-500"> · invested {agent.user_invested}</span>
                  </div>
                )}

                <button
                  onClick={() => {
                    setInvestModal(agent);
                    setInvestShares(1);
                  }}
                  className="w-full py-2.5 rounded-lg font-bold text-sm bg-gradient-to-r from-emerald-400 to-teal-500 text-black hover:from-emerald-300 hover:to-teal-400 active:scale-[0.98] transition-all"
                >
                  {agent.user_shares > 0 ? "Buy More Shares" : "Invest"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Teams Tab */}
      {tab === "teams" && (
        <div>
          <button
            onClick={() => setTeamModal(true)}
            className="mb-6 px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 transition-all"
          >
            + Create Team
          </button>

          {data.teams.length === 0 ? (
            <div className="glass rounded-xl p-12 text-center">
              <div className="text-4xl mb-3">⚔️</div>
              <h3 className="text-xl font-bold text-white mb-2">No Teams Yet</h3>
              <p className="text-zinc-500">
                Invest in agents, then form teams for Battleground matches.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.teams.map((team) => (
                <div key={team.id} className="glass rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-4xl">{team.avatar}</span>
                      <div>
                        <div className="font-bold text-white text-lg">{team.name}</div>
                        <div className="text-xs text-zinc-500">
                          {team.member_count} agents · ELO {team.elo}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-emerald-400">{team.wins}W</span>
                      <span className="text-red-400">{team.losses}L</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="space-y-6">
          {/* Betting History */}
          <div>
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">
              Betting History
            </h3>
            {data.bets.length === 0 ? (
              <div className="glass rounded-xl p-8 text-center text-zinc-600">
                No bets placed yet
              </div>
            ) : (
              <div className="glass rounded-xl overflow-hidden">
                {data.bets.map((bet) => (
                  <div
                    key={bet.id}
                    className="flex items-center justify-between px-5 py-3 border-b border-white/5 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{bet.agent_avatar}</span>
                      <div>
                        <div className="text-sm font-bold text-white">{bet.agent_name}</div>
                        <div className="text-xs text-zinc-600">
                          {bet.amount} coins @ {bet.odds.toFixed(2)}x
                        </div>
                      </div>
                    </div>
                    <div
                      className={`font-mono font-bold text-sm px-3 py-1 rounded ${
                        bet.status === "won"
                          ? "text-emerald-400 bg-emerald-400/10"
                          : bet.status === "lost"
                            ? "text-red-400 bg-red-400/10"
                            : "text-zinc-400 bg-zinc-400/10"
                      }`}
                    >
                      {bet.status === "won"
                        ? `+${bet.payout}`
                        : bet.status === "lost"
                          ? `-${bet.amount}`
                          : "pending"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Game History */}
          <div>
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">
              Recent Games
            </h3>
            <div className="glass rounded-xl overflow-hidden">
              {data.recentGames.map((game) => (
                <div
                  key={game.id}
                  className="flex items-center justify-between px-5 py-3 border-b border-white/5 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span>{game.white_avatar}</span>
                    <span className="text-sm text-white">{game.white_name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded">
                      {game.game_type}
                    </span>
                    <span
                      className={`font-mono font-bold text-sm ${
                        game.result === "1-0"
                          ? "text-emerald-400"
                          : game.result === "0-1"
                            ? "text-red-400"
                            : "text-zinc-400"
                      }`}
                    >
                      {game.result}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white">{game.black_name}</span>
                    <span>{game.black_avatar}</span>
                  </div>
                </div>
              ))}
              {data.recentGames.length === 0 && (
                <div className="text-zinc-600 text-center py-8">No games yet</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
