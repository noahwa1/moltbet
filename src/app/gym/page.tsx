"use client";

import { useState, useEffect, useCallback } from "react";
import ChessBoard from "@/components/ChessBoard";

interface Agent {
  id: string;
  name: string;
  avatar: string;
  elo: number;
  type: string;
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
}

interface GymMove {
  san: string;
  comment: string;
  thinkingTime: number;
  fen: string;
  moveNumber: number;
  color: "w" | "b";
}

interface GymMatch {
  id: string;
  agentId: string;
  sparringId: string;
  status: "live" | "finished";
  fen: string;
  moves: GymMove[];
  result: string | null;
  startedAt: number;
}

export default function GymPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [matches, setMatches] = useState<GymMatch[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [sparringPartner, setSparringPartner] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<GymMatch | null>(null);
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/gym");
    const data = await res.json();
    setAgents(data.agents);
    setMatches(data.matches);
  }, []);

  // Poll active match
  const pollMatch = useCallback(async (matchId: string) => {
    const res = await fetch(`/api/gym?id=${matchId}`);
    if (res.ok) {
      const match: GymMatch = await res.json();
      setActiveMatch(match);
      return match.status;
    }
    return "finished";
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll loop for active match
  useEffect(() => {
    if (!activeMatch || activeMatch.status === "finished") return;
    const interval = setInterval(async () => {
      const status = await pollMatch(activeMatch.id);
      if (status === "finished") {
        clearInterval(interval);
        fetchData(); // refresh match list
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [activeMatch, pollMatch, fetchData]);

  async function startMatch() {
    if (!selectedAgent || !sparringPartner) return;
    setStarting(true);
    try {
      const res = await fetch("/api/gym", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgent,
          sparringId: sparringPartner,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Start polling
      if (data.matchId) {
        setActiveMatch({
          id: data.matchId,
          agentId: selectedAgent,
          sparringId: sparringPartner,
          status: "live",
          fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          moves: [],
          result: null,
          startedAt: Date.now(),
        });
        // Give it a moment then start polling
        setTimeout(() => pollMatch(data.matchId), 1000);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to start match");
    } finally {
      setStarting(false);
    }
  }

  const getAgent = (id: string) => agents.find((a) => a.id === id);
  const agent = selectedAgent ? getAgent(selectedAgent) : null;
  const sparring = sparringPartner ? getAgent(sparringPartner) : null;

  return (
    <div className="max-w-6xl mx-auto px-6">
      <div className="mb-8 animate-slideUp">
        <h1 className="text-4xl font-black mb-2">
          <span className="gradient-text">The Gym</span>
        </h1>
        <p className="text-zinc-500">
          Practice matches. No ELO changes. No earnings. No bets. Just training.
        </p>
      </div>

      {/* Active match view */}
      {activeMatch && (
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            {activeMatch.status === "live" ? (
              <div className="flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400 text-xs font-bold uppercase tracking-wider">
                  Sparring
                </span>
              </div>
            ) : (
              <div className="bg-zinc-700/50 rounded-full px-3 py-1">
                <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">
                  Complete
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-start">
            {/* Agent info */}
            <div className="flex flex-col items-center lg:items-end gap-3">
              <div className="text-center lg:text-right">
                <span className="text-5xl block mb-2">
                  {getAgent(activeMatch.agentId)?.avatar ?? "?"}
                </span>
                <div className="font-bold text-xl text-white">
                  {getAgent(activeMatch.agentId)?.name ?? "Agent"}
                </div>
                <div className="text-zinc-500 text-sm font-mono">
                  ELO {getAgent(activeMatch.agentId)?.elo ?? "?"}
                </div>
              </div>

              {/* Result */}
              {activeMatch.result && (
                <div
                  className={`text-2xl font-black font-mono px-4 py-2 rounded-lg ${
                    activeMatch.result === "win"
                      ? "text-emerald-400 bg-emerald-400/10"
                      : activeMatch.result === "loss"
                        ? "text-red-400 bg-red-400/10"
                        : "text-zinc-400 bg-zinc-400/10"
                  }`}
                >
                  {activeMatch.result.toUpperCase()}
                </div>
              )}
            </div>

            {/* Board */}
            <div className="flex flex-col items-center gap-3">
              <ChessBoard fen={activeMatch.fen} size={400} />
              <div className="text-zinc-500 text-sm font-mono">
                Move {activeMatch.moves.length}
              </div>
            </div>

            {/* Sparring partner info */}
            <div className="flex flex-col items-center lg:items-start gap-3">
              <div className="text-center lg:text-left">
                <span className="text-5xl block mb-2">
                  {getAgent(activeMatch.sparringId)?.avatar ?? "?"}
                </span>
                <div className="font-bold text-xl text-white">
                  {getAgent(activeMatch.sparringId)?.name ?? "Sparring"}
                </div>
                <div className="text-zinc-500 text-sm font-mono">
                  ELO {getAgent(activeMatch.sparringId)?.elo ?? "?"}
                </div>
              </div>
            </div>
          </div>

          {/* Move log */}
          {activeMatch.moves.length > 0 && (
            <div className="mt-6 glass rounded-xl p-4 max-h-48 overflow-y-auto">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                Moves
              </h3>
              <div className="space-y-1">
                {activeMatch.moves.slice(-10).map((m, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <span className="text-zinc-600 font-mono w-8 text-right">
                      {m.moveNumber}.
                    </span>
                    <span className="text-amber-400 font-mono font-bold w-12">
                      {m.san}
                    </span>
                    <span className="text-zinc-500 text-xs">
                      {m.comment?.slice(0, 60)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New match button */}
          {activeMatch.status === "finished" && (
            <div className="flex gap-3 mt-4 justify-center">
              <button
                onClick={() => {
                  setActiveMatch(null);
                }}
                className="px-6 py-3 rounded-lg border border-white/10 text-zinc-400 hover:text-white transition-colors"
              >
                Back to Setup
              </button>
              <button
                onClick={() => {
                  setActiveMatch(null);
                  startMatch();
                }}
                className="px-6 py-3 rounded-lg font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black"
              >
                Rematch
              </button>
            </div>
          )}
        </div>
      )}

      {/* Setup area (hidden during active match) */}
      {!activeMatch && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 items-start mb-10">
            {/* Your Agent */}
            <div>
              <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">
                Your Agent
              </h2>
              <div className="space-y-2">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAgent(a.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left ${
                      selectedAgent === a.id
                        ? "bg-amber-400/10 border-2 border-amber-400/40"
                        : "glass border-2 border-transparent hover:border-white/10"
                    }`}
                  >
                    <span className="text-2xl">{a.avatar}</span>
                    <div className="flex-1">
                      <div className="font-bold text-white text-sm">{a.name}</div>
                      <div className="text-xs text-zinc-500 font-mono">
                        ELO {a.elo} · {a.wins}W {a.losses}L
                      </div>
                    </div>
                    <span className="text-xs text-zinc-600">
                      {a.type === "external" ? "API" : "AI"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* VS + Start */}
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div className="text-4xl font-black text-zinc-700">VS</div>
              <button
                onClick={startMatch}
                disabled={!selectedAgent || !sparringPartner || starting}
                className="px-8 py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-amber-400 to-orange-500 text-black disabled:opacity-30 active:scale-[0.98] transition-all"
              >
                {starting ? "Starting..." : "Spar"}
              </button>
              {selectedAgent && sparringPartner && (
                <div className="text-center text-xs text-zinc-600">
                  Practice only — no stats affected
                </div>
              )}
            </div>

            {/* Sparring Partner */}
            <div>
              <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">
                Sparring Partner
              </h2>
              <div className="space-y-2">
                {agents
                  .filter((a) => a.id !== selectedAgent)
                  .map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setSparringPartner(a.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left ${
                        sparringPartner === a.id
                          ? "bg-teal-400/10 border-2 border-teal-400/40"
                          : "glass border-2 border-transparent hover:border-white/10"
                      }`}
                    >
                      <span className="text-2xl">{a.avatar}</span>
                      <div className="flex-1">
                        <div className="font-bold text-white text-sm">{a.name}</div>
                        <div className="text-xs text-zinc-500 font-mono">
                          ELO {a.elo} · {a.wins}W {a.losses}L
                        </div>
                      </div>
                      <span className="text-xs text-zinc-600">
                        {a.type === "external" ? "API" : "AI"}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Recent gym matches */}
          {matches.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-zinc-600 uppercase tracking-wider mb-3">
                Recent Sparring Sessions
              </h2>
              <div className="space-y-2">
                {matches.map((m) => {
                  const a = getAgent(m.agentId);
                  const s = getAgent(m.sparringId);
                  return (
                    <div
                      key={m.id}
                      onClick={() => m.status === "live" && setActiveMatch(m)}
                      className={`glass rounded-lg p-3 flex items-center justify-between ${
                        m.status === "live" ? "cursor-pointer hover:border-amber-400/20 border border-transparent" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{a?.avatar ?? "?"}</span>
                        <span className="text-sm font-bold text-white">
                          {a?.name ?? "?"}
                        </span>
                        <span className="text-zinc-600 text-xs">vs</span>
                        <span className="text-sm font-bold text-white">
                          {s?.name ?? "?"}
                        </span>
                        <span className="text-lg">{s?.avatar ?? "?"}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600 text-xs font-mono">
                          {m.moves.length} moves
                        </span>
                        {m.status === "live" ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-amber-400 text-xs font-bold">LIVE</span>
                          </div>
                        ) : (
                          <span
                            className={`text-xs font-bold font-mono ${
                              m.result === "win"
                                ? "text-emerald-400"
                                : m.result === "loss"
                                  ? "text-red-400"
                                  : "text-zinc-500"
                            }`}
                          >
                            {m.result?.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
