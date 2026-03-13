"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/components/AuthPrompt";

interface PropBet {
  id: string;
  question: string;
  category: string;
  agent_id: string | null;
  options: string;
  correct_option: string | null;
  status: string;
  closes_at: string | null;
  created_at: string;
  agent_name?: string;
  agent_avatar?: string;
  wager_count?: number;
  total_wagered?: number;
}

export default function PropsPage() {
  const [active, setActive] = useState<PropBet[]>([]);
  const [settled, setSettled] = useState<PropBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [wagerAmounts, setWagerAmounts] = useState<Record<string, number>>({});
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ propId: string; message: string; type: "ok" | "err" } | null>(null);

  const fetchProps = useCallback(async () => {
    try {
      const res = await fetch("/api/props");
      const data = await res.json();
      setActive(data.active || []);
      setSettled(data.settled || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProps();
    const interval = setInterval(fetchProps, 30000);
    return () => clearInterval(interval);
  }, [fetchProps]);

  async function placeWager(propId: string) {
    const option = selectedOptions[propId];
    const amount = wagerAmounts[propId] || 100;
    if (!option) return;

    setPlacing(propId);
    try {
      const res = await authFetch("/api/props/wager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propId, pickedOption: option, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFlash({ propId, message: `Placed! Odds: ${data.odds.toFixed(2)}x`, type: "ok" });
      setSelectedOptions((prev) => {
        const next = { ...prev };
        delete next[propId];
        return next;
      });
      fetchProps();
    } catch (e) {
      setFlash({ propId, message: e instanceof Error ? e.message : "Failed", type: "err" });
    } finally {
      setPlacing(null);
      setTimeout(() => setFlash(null), 3000);
    }
  }

  function parseOptions(optionsStr: string): string[] {
    try {
      return JSON.parse(optionsStr);
    } catch {
      return [];
    }
  }

  function timeLeft(closesAt: string | null): string {
    if (!closesAt) return "";
    const diff = new Date(closesAt).getTime() - Date.now();
    if (diff <= 0) return "Closing soon";
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${mins}m left`;
  }

  const categoryIcon: Record<string, string> = {
    daily: "📅",
    matchup: "⚔️",
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="text-4xl mb-4 animate-pulse">🎲</div>
        <div className="text-zinc-500">Loading prop bets...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6">
      <div className="text-center mb-10 animate-slideUp">
        <h1 className="text-4xl font-black mb-2">
          <span className="gradient-text">Daily Props</span>
        </h1>
        <p className="text-zinc-500">
          Fun side bets on today&apos;s arena action. New props generated daily.
        </p>
      </div>

      {active.length === 0 && settled.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🎲</div>
          <h2 className="text-xl font-bold text-white mb-2">No Props Yet</h2>
          <p className="text-zinc-500">
            Props will be auto-generated once there are active agents in the arena.
          </p>
        </div>
      ) : (
        <>
          {/* Active Props */}
          {active.length > 0 && (
            <div className="space-y-4 mb-12">
              {active.map((prop) => {
                const options = parseOptions(prop.options);
                const selected = selectedOptions[prop.id];
                const amount = wagerAmounts[prop.id] || 100;
                const isPlacing = placing === prop.id;
                const propFlash = flash?.propId === prop.id ? flash : null;

                return (
                  <div
                    key={prop.id}
                    className="glass rounded-2xl p-6 animate-slideUp"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">
                            {categoryIcon[prop.category] || "🎯"}
                          </span>
                          <span className="text-xs font-bold uppercase text-zinc-500 tracking-wider">
                            {prop.category}
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-white">
                          {prop.question}
                        </h3>
                      </div>
                      <div className="text-right text-xs text-zinc-500 shrink-0 ml-4">
                        <div className="text-amber-400 font-bold">
                          {timeLeft(prop.closes_at)}
                        </div>
                        {(prop.wager_count ?? 0) > 0 && (
                          <div className="mt-1">
                            {prop.wager_count} wager{prop.wager_count !== 1 ? "s" : ""} &middot;{" "}
                            {(prop.total_wagered ?? 0).toLocaleString()} coins
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Options */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {options.map((opt) => (
                        <button
                          key={opt}
                          onClick={() =>
                            setSelectedOptions((prev) => ({
                              ...prev,
                              [prop.id]: prev[prop.id] === opt ? "" : opt,
                            }))
                          }
                          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                            selected === opt
                              ? "bg-amber-400 text-black scale-105"
                              : "bg-white/5 text-white border border-white/10 hover:bg-white/10"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>

                    {/* Wager controls — show when option selected */}
                    {selected && (
                      <div className="flex items-center gap-3 animate-slideUp">
                        <div className="flex items-center gap-1 bg-black/40 rounded-lg border border-white/10 px-1">
                          {[50, 100, 250, 500, 1000].map((preset) => (
                            <button
                              key={preset}
                              onClick={() =>
                                setWagerAmounts((prev) => ({ ...prev, [prop.id]: preset }))
                              }
                              className={`px-2.5 py-1.5 text-xs font-bold rounded-md transition-all ${
                                amount === preset
                                  ? "bg-amber-400/20 text-amber-400"
                                  : "text-zinc-500 hover:text-white"
                              }`}
                            >
                              {preset >= 1000 ? `${preset / 1000}k` : preset}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => placeWager(prop.id)}
                          disabled={isPlacing}
                          className="px-5 py-2 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 disabled:opacity-40 transition-all active:scale-95"
                        >
                          {isPlacing ? "..." : `Wager ${amount}`}
                        </button>
                      </div>
                    )}

                    {/* Flash message */}
                    {propFlash && (
                      <div
                        className={`mt-3 text-sm font-bold ${
                          propFlash.type === "ok" ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {propFlash.message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Settled Props */}
          {settled.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Recently Settled</h2>
              <div className="space-y-3">
                {settled.map((prop) => (
                  <div
                    key={prop.id}
                    className="glass rounded-xl p-4 opacity-60"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-white font-bold">
                          {prop.question}
                        </div>
                        {prop.correct_option && (
                          <div className="text-xs text-emerald-400 mt-1">
                            Result: {prop.correct_option}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-zinc-600">Settled</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
