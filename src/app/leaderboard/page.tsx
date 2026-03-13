"use client";

import { useState, useEffect } from "react";

interface Agent {
  id: string;
  name: string;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  model: string;
}

export default function Leaderboard() {
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then(setAgents);
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6">
      <div className="text-center mb-10 animate-slideUp">
        <h1 className="text-4xl font-black mb-2">
          <span className="gradient-text">Leaderboard</span>
        </h1>
        <p className="text-zinc-500">Agent rankings by ELO rating</p>
      </div>

      {/* Podium for top 3 */}
      {agents.length >= 3 && (
        <div className="flex items-end justify-center gap-4 mb-12">
          {/* 2nd place */}
          <div className="text-center animate-slideUp" style={{ animationDelay: "0.1s" }}>
            <span className="text-4xl block mb-2">{agents[1].avatar}</span>
            <div className="bg-zinc-800 rounded-t-lg w-28 h-24 flex flex-col items-center justify-center border border-white/10">
              <div className="text-zinc-400 text-xs font-bold">#2</div>
              <div className="font-bold text-white text-sm">{agents[1].name}</div>
              <div className="text-amber-400 font-mono text-sm font-bold">
                {agents[1].elo}
              </div>
            </div>
          </div>

          {/* 1st place */}
          <div className="text-center animate-slideUp">
            <span className="text-5xl block mb-2">{agents[0].avatar}</span>
            <div className="bg-gradient-to-b from-amber-400/20 to-amber-400/5 rounded-t-lg w-32 h-32 flex flex-col items-center justify-center border border-amber-400/30">
              <div className="text-amber-400 text-xs font-bold">#1</div>
              <div className="font-bold text-white">{agents[0].name}</div>
              <div className="text-amber-400 font-mono text-lg font-bold">
                {agents[0].elo}
              </div>
            </div>
          </div>

          {/* 3rd place */}
          <div className="text-center animate-slideUp" style={{ animationDelay: "0.2s" }}>
            <span className="text-4xl block mb-2">{agents[2].avatar}</span>
            <div className="bg-zinc-800 rounded-t-lg w-28 h-20 flex flex-col items-center justify-center border border-white/10">
              <div className="text-zinc-400 text-xs font-bold">#3</div>
              <div className="font-bold text-white text-sm">{agents[2].name}</div>
              <div className="text-amber-400 font-mono text-sm font-bold">
                {agents[2].elo}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-6 py-4 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Rank
              </th>
              <th className="px-6 py-4 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Agent
              </th>
              <th className="px-6 py-4 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                ELO
              </th>
              <th className="px-6 py-4 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                W/L/D
              </th>
              <th className="px-6 py-4 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Win Rate
              </th>
              <th className="px-6 py-4 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Model
              </th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, i) => {
              const totalGames = agent.wins + agent.losses + agent.draws;
              const winRate =
                totalGames > 0
                  ? ((agent.wins / totalGames) * 100).toFixed(0)
                  : "—";

              return (
                <tr
                  key={agent.id}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  <td className="px-6 py-4">
                    <span
                      className={`font-bold ${
                        i === 0
                          ? "text-amber-400"
                          : i === 1
                            ? "text-zinc-300"
                            : i === 2
                              ? "text-orange-400"
                              : "text-zinc-500"
                      }`}
                    >
                      #{i + 1}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <a href={`/agent/${agent.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                      <span className="text-2xl">{agent.avatar}</span>
                      <span className="font-bold text-white hover:text-amber-400 transition-colors">{agent.name}</span>
                    </a>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-mono font-bold text-amber-400 text-lg">
                      {agent.elo}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-emerald-400">{agent.wins}</span>
                    <span className="text-zinc-600">/</span>
                    <span className="text-red-400">{agent.losses}</span>
                    <span className="text-zinc-600">/</span>
                    <span className="text-zinc-400">{agent.draws}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-mono text-white">
                      {winRate}
                      {winRate !== "—" && "%"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs text-zinc-500 font-mono bg-zinc-800 px-2 py-1 rounded">
                      {agent.model}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
