"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/components/AuthPrompt";
import Link from "next/link";

interface Bet {
  id: string;
  game_id: string;
  game_type: string;
  agent_id: string;
  agent_name: string;
  agent_avatar: string;
  bet_type: string;
  line: number | null;
  side: string | null;
  amount: number;
  odds: number;
  status: string;
  payout: number;
  created_at: string;
}

interface BetStats {
  totalWagered: number;
  totalWon: number;
  netPnl: number;
  winRate: string;
  roi: string;
  totalBets: number;
  pendingBets: number;
  wonBets: number;
  lostBets: number;
}

interface HistoryData {
  bets: Bet[];
  stats: BetStats;
}

type FilterStatus = "all" | "pending" | "won" | "lost";

export default function BetHistoryPage() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [loading, setLoading] = useState(true);
  const [cashingOut, setCashingOut] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/bets/history");
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 5000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  async function handleCashOut(betId: string) {
    setCashingOut(betId);
    try {
      const res = await authFetch("/api/bets/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betId }),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || "Cash out failed");
      }
      fetchHistory();
    } catch {
      alert("Cash out failed");
    } finally {
      setCashingOut(null);
    }
  }

  function getPnL(bet: Bet): number | null {
    if (bet.status === "won") return bet.payout - bet.amount;
    if (bet.status === "lost") return -bet.amount;
    if (bet.status === "cashed_out") return bet.payout - bet.amount;
    return null;
  }

  function formatBetType(bet: Bet): string {
    if (bet.bet_type === "moneyline") return "ML";
    if (bet.bet_type === "spread") return `SPR ${bet.line ?? ""}`;
    if (bet.bet_type === "over_under") return `O/U ${bet.line ?? ""}`;
    return bet.bet_type;
  }

  const bets = data?.bets ?? [];
  const stats = data?.stats;
  const filtered =
    filter === "all" ? bets : bets.filter((b) => b.status === filter);

  const filters: { label: string; value: FilterStatus }[] = [
    { label: "All", value: "all" },
    { label: "Pending", value: "pending" },
    { label: "Won", value: "won" },
    { label: "Lost", value: "lost" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6">
      <div className="text-center mb-8 animate-slideUp">
        <h1 className="text-4xl font-black mb-2">
          <span className="gradient-text">Bet History</span>
        </h1>
        <p className="text-zinc-500">Your complete betting record and P&L</p>
      </div>

      {/* P&L Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8 animate-slideUp">
          <div className="glass rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              Total Wagered
            </div>
            <div className="text-xl font-black font-mono text-white">
              {stats.totalWagered.toLocaleString()}
            </div>
          </div>
          <div className="glass rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              Total Won
            </div>
            <div className="text-xl font-black font-mono text-emerald-400">
              +{stats.totalWon.toLocaleString()}
            </div>
          </div>
          <div className="glass rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              Net P&L
            </div>
            <div
              className={`text-xl font-black font-mono ${
                stats.netPnl >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {stats.netPnl >= 0 ? "+" : ""}
              {stats.netPnl.toLocaleString()}
            </div>
          </div>
          <div className="glass rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              Win Rate
            </div>
            <div className="text-xl font-black font-mono text-amber-400">
              {stats.winRate}%
            </div>
          </div>
          <div className="glass rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              ROI
            </div>
            <div
              className={`text-xl font-black font-mono ${
                parseFloat(stats.roi) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {stats.roi}%
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              filter === f.value
                ? "bg-amber-400 text-black"
                : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            {f.label}
            <span className="ml-1.5 text-xs opacity-70">
              ({f.value === "all"
                ? stats?.totalBets ?? 0
                : f.value === "pending"
                  ? stats?.pendingBets ?? 0
                  : f.value === "won"
                    ? stats?.wonBets ?? 0
                    : stats?.lostBets ?? 0})
            </span>
          </button>
        ))}
      </div>

      {/* Bet list */}
      {loading ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4 animate-bounce">🎲</div>
          <div className="text-zinc-500">Loading bets...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 glass rounded-xl">
          <div className="text-4xl mb-4">📭</div>
          <p className="text-zinc-500 mb-2">
            {filter === "all"
              ? "No bets placed yet."
              : `No ${filter} bets.`}
          </p>
          {filter === "all" && (
            <Link
              href="/"
              className="text-amber-400 hover:text-amber-300 font-bold text-sm transition-colors"
            >
              Go to Arena to place a bet &rarr;
            </Link>
          )}
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Agent
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Game
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Odds
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Payout
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  P&L
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((bet) => {
                const pnl = getPnL(bet);
                return (
                  <tr
                    key={bet.id}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{bet.agent_avatar}</span>
                        <span className="font-bold text-white text-sm">
                          {bet.agent_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded">
                        {bet.game_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs text-zinc-400 font-mono">
                        {formatBetType(bet)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-amber-400 font-bold">
                      {bet.amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-emerald-400 font-mono font-bold text-sm">
                        {bet.odds.toFixed(2)}x
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-xs font-bold uppercase px-2 py-1 rounded ${
                          bet.status === "won"
                            ? "bg-emerald-400/10 text-emerald-400"
                            : bet.status === "lost"
                              ? "bg-red-400/10 text-red-400"
                              : bet.status === "cashed_out"
                                ? "bg-teal-400/10 text-teal-400"
                                : "bg-amber-400/10 text-amber-400"
                        }`}
                      >
                        {bet.status === "cashed_out"
                          ? "CASHED OUT"
                          : bet.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {bet.payout > 0 ? (
                        <span className="text-emerald-400 font-bold">
                          +{bet.payout.toLocaleString()}
                        </span>
                      ) : bet.status === "pending" ? (
                        <span className="text-zinc-600">
                          ~{Math.round(bet.amount * bet.odds).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-zinc-600">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold">
                      {pnl !== null ? (
                        <span
                          className={
                            pnl >= 0 ? "text-emerald-400" : "text-red-400"
                          }
                        >
                          {pnl >= 0 ? "+" : ""}
                          {pnl.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-zinc-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {bet.status === "pending" && (
                        <button
                          onClick={() => handleCashOut(bet.id)}
                          disabled={cashingOut === bet.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-400/10 text-teal-400 border border-teal-400/30 hover:bg-teal-400/20 transition-all disabled:opacity-50"
                        >
                          {cashingOut === bet.id ? "..." : "Cash Out"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
