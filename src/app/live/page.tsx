"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import ChessBoard from "@/components/ChessBoard";

interface LiveGame {
  id: string;
  white_id: string;
  black_id: string;
  white_name: string;
  black_name: string;
  white_avatar: string;
  black_avatar: string;
  white_elo: number;
  black_elo: number;
  status: string;
  fen: string;
  moves: string;
  result: string | null;
  odds: { white: number; black: number; draw: number };
  liveOdds?: {
    white: number;
    black: number;
    whiteWinProb: number;
    blackWinProb: number;
    drawProb: number;
    evaluation: number;
    momentum: "white" | "black" | "neutral";
  } | null;
  oddsHistory?: Array<{
    moveNumber: number;
    evaluation: number;
  }>;
}

interface ParsedMove {
  san: string;
  comment: string;
  color: "w" | "b";
  moveNumber: number;
}

type ViewMode = "grid" | "redzone";

export default function LivePage() {
  const [games, setGames] = useState<LiveGame[]>([]);
  const [fullGames, setFullGames] = useState<Map<string, LiveGame>>(new Map());
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [redzoneId, setRedzoneId] = useState<string | null>(null);
  const [redzoneAuto, setRedzoneAuto] = useState(true);
  const prevEvalsRef = useRef<Map<string, number>>(new Map());
  const router = useRouter();

  const fetchGames = useCallback(async () => {
    const res = await fetch("/api/games");
    const all: LiveGame[] = await res.json();
    setGames(all);

    // Fetch full data for each live game
    const live = all.filter((g) => g.status === "live");
    const updates = new Map(fullGames);

    await Promise.all(
      live.map(async (g) => {
        try {
          const res = await fetch(`/api/games/${g.id}`);
          const data = await res.json();
          updates.set(g.id, data);
        } catch {
          /* skip */
        }
      })
    );

    setFullGames(updates);

    // RedZone auto-switch: find the game with the biggest eval swing
    if (redzoneAuto && live.length > 0) {
      let mostExciting = live[0].id;
      let biggestSwing = 0;

      for (const g of live) {
        const full = updates.get(g.id);
        if (!full?.liveOdds) continue;

        const prevEval = prevEvalsRef.current.get(g.id) ?? 0;
        const currentEval = full.liveOdds.evaluation;
        const swing = Math.abs(currentEval - prevEval);

        if (swing > biggestSwing) {
          biggestSwing = swing;
          mostExciting = g.id;
        }

        prevEvalsRef.current.set(g.id, currentEval);
      }

      // Only switch if there's a meaningful swing (> 0.5 eval change)
      if (biggestSwing > 0.5 || !redzoneId) {
        setRedzoneId(mostExciting);
      }
    }
  }, [fullGames, redzoneAuto, redzoneId]);

  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 2000);
    return () => clearInterval(interval);
  }, []);

  // Periodic refresh that doesn't cause infinite loop
  useEffect(() => {
    const interval = setInterval(() => {
      fetchGames();
    }, 2000);
    return () => clearInterval(interval);
  }, [redzoneAuto, redzoneId]);

  const liveGames = games.filter((g) => g.status === "live");
  const pendingGames = games.filter((g) => g.status === "pending");
  const redzoneGame = redzoneId ? fullGames.get(redzoneId) : null;

  function getMoves(gameId: string): ParsedMove[] {
    const full = fullGames.get(gameId);
    if (!full) return [];
    try {
      return JSON.parse(full.moves || "[]");
    } catch {
      return [];
    }
  }

  function getLastMove(gameId: string): ParsedMove | null {
    const moves = getMoves(gameId);
    return moves.length > 0 ? moves[moves.length - 1] : null;
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-black">
            <span className="gradient-text">Live</span>
          </h1>
          <p className="text-zinc-500 text-sm">
            {liveGames.length} match{liveGames.length !== 1 ? "es" : ""} in progress
            {pendingGames.length > 0 && ` · ${pendingGames.length} upcoming`}
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
              viewMode === "grid"
                ? "bg-white/10 text-white"
                : "text-zinc-500 hover:text-white"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => {
              setViewMode("redzone");
              setRedzoneAuto(true);
            }}
            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
              viewMode === "redzone"
                ? "bg-red-500/20 text-red-400"
                : "text-zinc-500 hover:text-white"
            }`}
          >
            RedZone
          </button>
        </div>
      </div>

      {/* No live games */}
      {liveGames.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📺</div>
          <h2 className="text-xl font-bold text-white mb-2">No live matches right now</h2>
          <p className="text-zinc-500 mb-4">
            {pendingGames.length > 0
              ? `${pendingGames.length} match${pendingGames.length !== 1 ? "es" : ""} coming up`
              : "Matches are scheduled automatically"}
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 rounded-lg text-sm font-bold bg-white/10 text-white hover:bg-white/20 transition-all"
          >
            Back to Arena
          </button>
        </div>
      )}

      {/* === GRID MODE === */}
      {viewMode === "grid" && liveGames.length > 0 && (
        <div
          className={`grid gap-4 ${
            liveGames.length === 1
              ? "grid-cols-1 max-w-2xl mx-auto"
              : liveGames.length === 2
                ? "grid-cols-1 lg:grid-cols-2"
                : liveGames.length <= 4
                  ? "grid-cols-1 md:grid-cols-2"
                  : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          }`}
        >
          {liveGames.map((game) => {
            const full = fullGames.get(game.id);
            const lastMove = getLastMove(game.id);
            const odds = full?.liveOdds ?? game.liveOdds;
            const fen = full?.fen ?? game.fen;
            const moveCount = getMoves(game.id).length;
            const boardSize = liveGames.length <= 2 ? 320 : liveGames.length <= 4 ? 260 : 220;

            return (
              <div
                key={game.id}
                onClick={() => router.push(`/game/${game.id}`)}
                className="glass rounded-xl p-4 cursor-pointer hover:border-red-500/20 border border-transparent transition-all group"
              >
                {/* Match header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                    <span className="text-red-400 text-[10px] font-bold uppercase">Live</span>
                  </div>
                  {odds && (
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        odds.momentum === "white"
                          ? "text-emerald-400"
                          : odds.momentum === "black"
                            ? "text-red-400"
                            : "text-zinc-500"
                      }`}
                    >
                      {odds.momentum === "white"
                        ? "⬆ White"
                        : odds.momentum === "black"
                          ? "⬇ Black"
                          : "Even"}
                    </span>
                  )}
                  <span className="text-zinc-600 text-xs font-mono">
                    Move {moveCount}
                  </span>
                </div>

                {/* Players */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{game.white_avatar}</span>
                    <div>
                      <div className="text-sm font-bold text-white">{game.white_name}</div>
                      <div className="text-[10px] text-zinc-600 font-mono">{game.white_elo}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="text-sm font-bold text-white">{game.black_name}</div>
                      <div className="text-[10px] text-zinc-600 font-mono">{game.black_elo}</div>
                    </div>
                    <span className="text-xl">{game.black_avatar}</span>
                  </div>
                </div>

                {/* Board */}
                <div className="flex justify-center mb-3">
                  <ChessBoard fen={fen} size={boardSize} />
                </div>

                {/* Win probability bar */}
                {odds && (
                  <div className="mb-2">
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-800">
                      <div
                        className="bg-emerald-500 transition-all duration-700"
                        style={{ width: `${odds.whiteWinProb * 100}%` }}
                      />
                      <div
                        className="bg-zinc-600 transition-all duration-700"
                        style={{ width: `${odds.drawProb * 100}%` }}
                      />
                      <div
                        className="bg-red-500 transition-all duration-700"
                        style={{ width: `${odds.blackWinProb * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] mt-1">
                      <span className="text-emerald-400 font-mono">
                        {(odds.whiteWinProb * 100).toFixed(0)}%
                      </span>
                      <span className="text-red-400 font-mono">
                        {(odds.blackWinProb * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Odds */}
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-400 font-mono font-bold">
                    {(odds?.white ?? game.odds.white).toFixed(2)}x
                  </span>
                  <span className="text-zinc-600 font-mono text-xs">
                    Draw {game.odds.draw.toFixed(1)}
                  </span>
                  <span className="text-emerald-400 font-mono font-bold">
                    {(odds?.black ?? game.odds.black).toFixed(2)}x
                  </span>
                </div>

                {/* Last move */}
                {lastMove && (
                  <div className="mt-2 bg-black/30 rounded-lg px-3 py-2 text-xs">
                    <span className="text-amber-400 font-mono font-bold">{lastMove.san}</span>
                    <span className="text-zinc-500 ml-2">
                      {lastMove.comment?.slice(0, 50)}
                    </span>
                  </div>
                )}

                {/* Hover hint */}
                <div className="text-center mt-2 text-[10px] text-zinc-700 group-hover:text-zinc-400 transition-colors">
                  Click for full view
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* === REDZONE MODE === */}
      {viewMode === "redzone" && liveGames.length > 0 && (
        <div>
          {/* RedZone controls */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500 live-dot" />
                <span className="text-red-400 text-xs font-bold uppercase tracking-wider">
                  RedZone
                </span>
              </div>
              <button
                onClick={() => setRedzoneAuto(!redzoneAuto)}
                className={`text-xs px-3 py-1.5 rounded-full transition-all ${
                  redzoneAuto
                    ? "bg-amber-400/10 text-amber-400 border border-amber-400/30"
                    : "bg-white/5 text-zinc-500 border border-white/10"
                }`}
              >
                Auto-Switch {redzoneAuto ? "ON" : "OFF"}
              </button>
            </div>
            <div className="text-zinc-500 text-xs">
              Auto-switches to the most exciting match
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
            {/* Main featured match */}
            {redzoneGame && (
              <div className="glass rounded-xl p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <span className="text-4xl">{redzoneGame.white_avatar}</span>
                    <div>
                      <div className="font-bold text-white text-lg">
                        {redzoneGame.white_name}
                      </div>
                      <div className="text-zinc-500 text-xs font-mono">
                        ELO {redzoneGame.white_elo}
                      </div>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-black text-zinc-600">VS</div>
                    {redzoneGame.liveOdds && (
                      <span
                        className={`text-[10px] font-bold uppercase ${
                          redzoneGame.liveOdds.momentum === "white"
                            ? "text-emerald-400"
                            : redzoneGame.liveOdds.momentum === "black"
                              ? "text-red-400"
                              : "text-zinc-500"
                        }`}
                      >
                        {redzoneGame.liveOdds.momentum === "neutral"
                          ? "Even"
                          : `${redzoneGame.liveOdds.momentum === "white" ? redzoneGame.white_name : redzoneGame.black_name} Momentum`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-bold text-white text-lg">
                        {redzoneGame.black_name}
                      </div>
                      <div className="text-zinc-500 text-xs font-mono">
                        ELO {redzoneGame.black_elo}
                      </div>
                    </div>
                    <span className="text-4xl">{redzoneGame.black_avatar}</span>
                  </div>
                </div>

                {/* Board */}
                <div className="flex justify-center mb-4">
                  <div
                    className="cursor-pointer"
                    onClick={() => router.push(`/game/${redzoneGame.id}`)}
                  >
                    <ChessBoard fen={redzoneGame.fen} size={440} />
                  </div>
                </div>

                {/* Win prob bar */}
                {redzoneGame.liveOdds && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-emerald-400 font-mono text-sm font-bold">
                        {(redzoneGame.liveOdds.whiteWinProb * 100).toFixed(0)}%
                      </span>
                      <span className="text-red-400 font-mono text-sm font-bold">
                        {(redzoneGame.liveOdds.blackWinProb * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex h-3 rounded-full overflow-hidden bg-zinc-800">
                      <div
                        className="bg-emerald-500 transition-all duration-700"
                        style={{
                          width: `${redzoneGame.liveOdds.whiteWinProb * 100}%`,
                        }}
                      />
                      <div
                        className="bg-zinc-600 transition-all duration-700"
                        style={{
                          width: `${redzoneGame.liveOdds.drawProb * 100}%`,
                        }}
                      />
                      <div
                        className="bg-red-500 transition-all duration-700"
                        style={{
                          width: `${redzoneGame.liveOdds.blackWinProb * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Latest move */}
                {(() => {
                  const lastMove = getLastMove(redzoneGame.id);
                  if (!lastMove) return null;
                  return (
                    <div className="bg-black/30 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">
                          {lastMove.color === "w"
                            ? redzoneGame.white_avatar
                            : redzoneGame.black_avatar}
                        </span>
                        <span className="text-amber-400 font-mono font-bold text-lg">
                          {lastMove.san}
                        </span>
                        <span className="text-zinc-500 text-sm">
                          {lastMove.comment?.slice(0, 80)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <div className="text-center mt-3">
                  <button
                    onClick={() => router.push(`/game/${redzoneGame.id}`)}
                    className="text-amber-400 hover:text-amber-300 text-sm font-bold transition-colors"
                  >
                    Full Spectator View →
                  </button>
                </div>
              </div>
            )}

            {/* Sidebar: all live games as mini cards */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                All Live
              </h3>
              {liveGames.map((game) => {
                const full = fullGames.get(game.id);
                const odds = full?.liveOdds ?? game.liveOdds;
                const isActive = game.id === redzoneId;
                const moveCount = getMoves(game.id).length;

                return (
                  <button
                    key={game.id}
                    onClick={() => {
                      setRedzoneId(game.id);
                      setRedzoneAuto(false);
                    }}
                    className={`w-full glass rounded-lg p-3 text-left transition-all ${
                      isActive
                        ? "border-2 border-red-500/40 bg-red-500/5"
                        : "border-2 border-transparent hover:border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{game.white_avatar}</span>
                        <span className="text-xs font-bold text-white">
                          {game.white_name}
                        </span>
                      </div>
                      <span className="text-zinc-600 text-[10px] font-mono">
                        M{moveCount}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {game.black_name}
                        </span>
                        <span className="text-sm">{game.black_avatar}</span>
                      </div>
                    </div>

                    {/* Mini prob bar */}
                    {odds && (
                      <div className="flex h-1 rounded-full overflow-hidden bg-zinc-800">
                        <div
                          className="bg-emerald-500 transition-all"
                          style={{ width: `${odds.whiteWinProb * 100}%` }}
                        />
                        <div
                          className="bg-zinc-600 transition-all"
                          style={{ width: `${odds.drawProb * 100}%` }}
                        />
                        <div
                          className="bg-red-500 transition-all"
                          style={{ width: `${odds.blackWinProb * 100}%` }}
                        />
                      </div>
                    )}

                    {isActive && (
                      <div className="text-[10px] text-red-400 font-bold mt-1 text-center">
                        WATCHING
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Upcoming */}
              {pendingGames.length > 0 && (
                <>
                  <h3 className="text-xs font-bold text-zinc-600 uppercase tracking-wider mt-4">
                    Up Next
                  </h3>
                  {pendingGames.slice(0, 5).map((game) => (
                    <div
                      key={game.id}
                      className="glass rounded-lg p-3 opacity-50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{game.white_avatar}</span>
                          <span className="text-xs text-white">
                            {game.white_name}
                          </span>
                        </div>
                        <span className="text-zinc-600 text-[10px]">vs</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white">
                            {game.black_name}
                          </span>
                          <span className="text-sm">{game.black_avatar}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
