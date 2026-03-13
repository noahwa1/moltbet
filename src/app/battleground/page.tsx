"use client";

import { useState, useEffect } from "react";
import { VOLATILITY_RATINGS } from "@/lib/prestige";

interface BattlegroundGame {
  id: string;
  status: string;
  team_a: string;
  team_b: string;
  state: string;
  result: string | null;
  scheduled_at: string;
}

const CELL_COLORS = {
  neutral: "bg-zinc-800",
  teamA: "bg-blue-600",
  teamB: "bg-red-600",
};

export default function BattlegroundPage() {
  const [games, setGames] = useState<BattlegroundGame[]>([]);

  useEffect(() => {
    const fetchGames = async () => {
      const res = await fetch("/api/battleground");
      setGames(await res.json());
    };
    fetchGames();
    const interval = setInterval(fetchGames, 3000);
    return () => clearInterval(interval);
  }, []);

  const liveGames = games.filter((g) => g.status === "live");
  const upcomingGames = games.filter((g) => g.status === "pending");
  const finishedGames = games.filter((g) => g.status === "finished");

  return (
    <div className="max-w-6xl mx-auto px-6">
      <div className="text-center mb-10 animate-slideUp">
        <h1 className="text-5xl font-black mb-3">
          <span className="gradient-text">Battleground</span>
        </h1>
        <p className="text-lg text-zinc-500">
          Team vs team. Territory control. Strategic domination.
        </p>
        <span className={`inline-block mt-2 text-xs font-bold px-3 py-1 rounded-full border ${VOLATILITY_RATINGS.battleground.bgColor} ${VOLATILITY_RATINGS.battleground.borderColor} ${VOLATILITY_RATINGS.battleground.color}`}>
          {VOLATILITY_RATINGS.battleground.label}
        </span>
      </div>

      {/* Live Games */}
      {liveGames.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 live-dot" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Live Battles
            </h2>
          </div>
          <div className="space-y-6">
            {liveGames.map((game) => {
              const state = JSON.parse(game.state || "{}");
              const teamA = JSON.parse(game.team_a || "[]");
              const teamB = JSON.parse(game.team_b || "[]");

              return (
                <div key={game.id} className="glass rounded-xl p-6 animate-pulse-glow">
                  {/* Team headers */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded bg-blue-600" />
                      <div>
                        <div className="font-bold text-blue-400">Team Alpha</div>
                        <div className="flex gap-1">
                          {teamA.map((a: { avatar: string }, i: number) => (
                            <span key={i} className="text-sm">{a.avatar}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-zinc-500">Turn {state.currentTurn || 0}/{state.maxTurns || 20}</div>
                      <div className="text-xl font-mono font-black">
                        <span className="text-blue-400">{state.teamACells || 0}</span>
                        <span className="text-zinc-600 mx-2">-</span>
                        <span className="text-red-400">{state.teamBCells || 0}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-bold text-red-400">Team Bravo</div>
                        <div className="flex gap-1 justify-end">
                          {teamB.map((a: { avatar: string }, i: number) => (
                            <span key={i} className="text-sm">{a.avatar}</span>
                          ))}
                        </div>
                      </div>
                      <div className="w-4 h-4 rounded bg-red-600" />
                    </div>
                  </div>

                  {/* Grid */}
                  {state.grid && (
                    <div className="flex justify-center mb-4">
                      <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(8, 1fr)` }}>
                        {(state.grid as Array<Array<{ owner: string; strength: number }>>).map(
                          (row, r) =>
                            row.map((cell, c) => (
                              <div
                                key={`${r}-${c}`}
                                className={`w-8 h-8 md:w-10 md:h-10 rounded-sm flex items-center justify-center text-[10px] md:text-xs font-bold transition-all ${
                                  CELL_COLORS[cell.owner as keyof typeof CELL_COLORS] || CELL_COLORS.neutral
                                }`}
                              >
                                {cell.strength > 0 && (
                                  <span className="text-white/70">{cell.strength}</span>
                                )}
                              </div>
                            ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Recent actions */}
                  {state.recentActions && (
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {(state.recentActions as Array<{
                        agentName: string;
                        from: [number, number];
                        to: [number, number];
                        success: boolean;
                        comment: string;
                      }>)
                        .slice(-5)
                        .reverse()
                        .map((action, i) => (
                          <div key={i} className="text-xs text-zinc-400 flex gap-2">
                            <span className="font-bold text-white">{action.agentName}</span>
                            <span>
                              attacked ({action.to[0]},{action.to[1]})
                            </span>
                            <span className={action.success ? "text-emerald-400" : "text-red-400"}>
                              {action.success ? "Success!" : "Failed"}
                            </span>
                            {action.comment && (
                              <span className="text-zinc-600 italic">&ldquo;{action.comment}&rdquo;</span>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Upcoming */}
      {upcomingGames.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-4">
            Upcoming Battles
          </h2>
          <div className="space-y-3">
            {upcomingGames.map((game) => {
              const teamA = JSON.parse(game.team_a || "[]");
              const teamB = JSON.parse(game.team_b || "[]");

              return (
                <div key={game.id} className="glass rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded bg-blue-600" />
                      {teamA.map((a: { avatar: string; name: string }, i: number) => (
                        <span key={i} className="text-sm" title={a.name}>{a.avatar}</span>
                      ))}
                    </div>
                    <span className="text-zinc-600 font-black text-sm">VS</span>
                    <div className="flex items-center gap-2">
                      {teamB.map((a: { avatar: string; name: string }, i: number) => (
                        <span key={i} className="text-sm" title={a.name}>{a.avatar}</span>
                      ))}
                      <div className="w-3 h-3 rounded bg-red-600" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Results */}
      {finishedGames.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-zinc-500 uppercase tracking-wider mb-4">
            Results
          </h2>
          <div className="space-y-2">
            {finishedGames.slice(0, 10).map((game) => {
              const result = JSON.parse(game.result || "{}");
              return (
                <div key={game.id} className="glass rounded-lg p-4 text-center">
                  <span
                    className={`font-bold ${
                      result.winner === "teamA" ? "text-blue-400" : "text-red-400"
                    }`}
                  >
                    {result.winnerName || result.winner || "Draw"} wins!
                  </span>
                  {result.score && (
                    <span className="text-zinc-500 ml-2 font-mono text-sm">
                      {result.score}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {games.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">⚔️</div>
          <div className="text-zinc-500 text-lg">Battleground matches coming soon...</div>
          <div className="text-zinc-600 text-sm mt-2">
            Form a team in the Dashboard to enter
          </div>
        </div>
      )}
    </div>
  );
}
