"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import ChessBoard from "@/components/ChessBoard";

interface ChessGame {
  gameType: "chess";
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
}

interface PokerGame {
  gameType: "poker";
  id: string;
  status: string;
  players: string;
  state: string;
  result: string | null;
}

interface BattlegroundGame {
  gameType: "battleground";
  id: string;
  status: string;
  team_a: string;
  team_b: string;
  state: string;
  result: string | null;
}

type AnyGame = ChessGame | PokerGame | BattlegroundGame;

interface ParsedMove {
  san: string;
  comment: string;
  color: "w" | "b";
  moveNumber: number;
}

export default function LivePage() {
  const [allGames, setAllGames] = useState<AnyGame[]>([]);
  const [chessDetails, setChessDetails] = useState<Map<string, ChessGame>>(new Map());
  const [filter, setFilter] = useState<"all" | "chess" | "poker" | "battleground">("all");
  const router = useRouter();
  const mountedRef = useRef(true);

  const fetchGames = useCallback(async () => {
    try {
      const [chessRes, pokerRes, bgRes] = await Promise.all([
        fetch("/api/games"),
        fetch("/api/poker"),
        fetch("/api/battleground"),
      ]);

      const chess: ChessGame[] = (await chessRes.json()).map((g: ChessGame) => ({ ...g, gameType: "chess" as const }));
      const poker: PokerGame[] = (await pokerRes.json()).map((g: PokerGame) => ({ ...g, gameType: "poker" as const }));
      const bg: BattlegroundGame[] = (await bgRes.json()).map((g: BattlegroundGame) => ({ ...g, gameType: "battleground" as const }));

      const combined: AnyGame[] = [...chess, ...poker, ...bg];
      if (!mountedRef.current) return;
      setAllGames(combined);

      // Fetch full data for live chess games
      const liveChess = chess.filter((g) => g.status === "live");
      if (liveChess.length > 0) {
        const updates = new Map(chessDetails);
        await Promise.all(
          liveChess.map(async (g) => {
            try {
              const res = await fetch(`/api/games/${g.id}`);
              const data = await res.json();
              updates.set(g.id, { ...data, gameType: "chess" as const });
            } catch { /* skip */ }
          })
        );
        if (mountedRef.current) setChessDetails(updates);
      }
    } catch { /* skip */ }
  }, [chessDetails]);

  useEffect(() => {
    mountedRef.current = true;
    fetchGames();
    const interval = setInterval(fetchGames, 3000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const liveGames = allGames.filter((g) => g.status === "live");
  const pendingGames = allGames.filter((g) => g.status === "pending");

  const filtered = filter === "all"
    ? liveGames
    : liveGames.filter((g) => g.gameType === filter);

  const filteredPending = filter === "all"
    ? pendingGames
    : pendingGames.filter((g) => g.gameType === filter);

  function getChessMoves(gameId: string): ParsedMove[] {
    const full = chessDetails.get(gameId);
    if (!full) return [];
    try { return JSON.parse(full.moves || "[]"); } catch { return []; }
  }

  const gameTypeIcon: Record<string, string> = {
    chess: "♟",
    poker: "🃏",
    battleground: "⚔️",
  };

  const liveChessCount = liveGames.filter((g) => g.gameType === "chess").length;
  const livePokerCount = liveGames.filter((g) => g.gameType === "poker").length;
  const liveBgCount = liveGames.filter((g) => g.gameType === "battleground").length;

  return (
    <div className="max-w-[1400px] mx-auto px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black">
            <span className="gradient-text">Live</span>
          </h1>
          <p className="text-zinc-500 text-sm">
            {liveGames.length} match{liveGames.length !== 1 ? "es" : ""} in progress
            {pendingGames.length > 0 && ` · ${pendingGames.length} upcoming`}
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
          {([
            { key: "all", label: "All", count: liveGames.length },
            { key: "chess", label: "♟ Chess", count: liveChessCount },
            { key: "poker", label: "🃏 Poker", count: livePokerCount },
            { key: "battleground", label: "⚔️ Battle", count: liveBgCount },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-2 rounded-md text-xs font-bold transition-all ${
                filter === tab.key
                  ? "bg-white/10 text-white"
                  : "text-zinc-500 hover:text-white"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full text-[10px]">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* No live games */}
      {filtered.length === 0 && filteredPending.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📺</div>
          <h2 className="text-xl font-bold text-white mb-2">No live matches right now</h2>
          <p className="text-zinc-500 mb-4">
            Matches are scheduled automatically
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 rounded-lg text-sm font-bold bg-white/10 text-white hover:bg-white/20 transition-all"
          >
            Back to Arena
          </button>
        </div>
      )}

      {/* Live Games Grid */}
      {filtered.length > 0 && (
        <div
          className={`grid gap-4 mb-8 ${
            filtered.length === 1
              ? "grid-cols-1 max-w-2xl mx-auto"
              : filtered.length === 2
                ? "grid-cols-1 lg:grid-cols-2"
                : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          }`}
        >
          {filtered.map((game) => {
            if (game.gameType === "chess") return <ChessCard key={game.id} game={game} chessDetails={chessDetails} getChessMoves={getChessMoves} router={router} totalGames={filtered.length} />;
            if (game.gameType === "poker") return <PokerCard key={game.id} game={game} router={router} />;
            if (game.gameType === "battleground") return <BattlegroundCard key={game.id} game={game} router={router} />;
            return null;
          })}
        </div>
      )}

      {/* Upcoming */}
      {filteredPending.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
            Up Next
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredPending.slice(0, 6).map((game) => (
              <div key={game.id} className="glass rounded-lg p-3 opacity-50">
                <div className="flex items-center gap-2">
                  <span>{gameTypeIcon[game.gameType]}</span>
                  <span className="text-xs text-zinc-400 uppercase font-bold">{game.gameType}</span>
                  <span className="text-zinc-600 text-[10px]">Pending</span>
                </div>
                {game.gameType === "chess" && (
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-white">{(game as ChessGame).white_avatar} {(game as ChessGame).white_name}</span>
                    <span className="text-zinc-600 text-[10px]">vs</span>
                    <span className="text-xs text-white">{(game as ChessGame).black_name} {(game as ChessGame).black_avatar}</span>
                  </div>
                )}
                {game.gameType === "poker" && (() => {
                  try {
                    const players = JSON.parse((game as PokerGame).players);
                    return (
                      <div className="flex items-center gap-1 mt-2">
                        {players.map((p: { avatar: string; name: string }, i: number) => (
                          <span key={i} className="text-sm" title={p.name}>{p.avatar}</span>
                        ))}
                      </div>
                    );
                  } catch { return null; }
                })()}
                {game.gameType === "battleground" && (() => {
                  try {
                    const teamA = JSON.parse((game as BattlegroundGame).team_a);
                    const teamB = JSON.parse((game as BattlegroundGame).team_b);
                    return (
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex gap-1">{teamA.map((a: { avatar: string }, i: number) => <span key={i} className="text-sm">{a.avatar}</span>)}</div>
                        <span className="text-zinc-600 text-[10px]">vs</span>
                        <div className="flex gap-1">{teamB.map((a: { avatar: string }, i: number) => <span key={i} className="text-sm">{a.avatar}</span>)}</div>
                      </div>
                    );
                  } catch { return null; }
                })()}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ CHESS CARD ============ */
function ChessCard({
  game,
  chessDetails,
  getChessMoves,
  router,
  totalGames,
}: {
  game: ChessGame;
  chessDetails: Map<string, ChessGame>;
  getChessMoves: (id: string) => ParsedMove[];
  router: ReturnType<typeof useRouter>;
  totalGames: number;
}) {
  const full = chessDetails.get(game.id);
  const odds = full?.liveOdds ?? game.liveOdds;
  const fen = full?.fen ?? game.fen;
  const moves = getChessMoves(game.id);
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;
  const boardSize = totalGames <= 2 ? 320 : totalGames <= 4 ? 260 : 220;

  return (
    <div
      onClick={() => router.push(`/game/${game.id}`)}
      className="glass rounded-xl p-4 cursor-pointer hover:border-amber-500/20 border border-transparent transition-all group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
          <span className="text-red-400 text-[10px] font-bold uppercase">Live</span>
          <span className="text-zinc-600 text-[10px]">♟ Chess</span>
        </div>
        <span className="text-zinc-600 text-xs font-mono">Move {moves.length}</span>
      </div>

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

      <div className="flex justify-center mb-3">
        <ChessBoard fen={fen} size={boardSize} />
      </div>

      {odds && (
        <div className="mb-2">
          <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-800">
            <div className="bg-emerald-500 transition-all duration-700" style={{ width: `${odds.whiteWinProb * 100}%` }} />
            <div className="bg-zinc-600 transition-all duration-700" style={{ width: `${odds.drawProb * 100}%` }} />
            <div className="bg-red-500 transition-all duration-700" style={{ width: `${odds.blackWinProb * 100}%` }} />
          </div>
          <div className="flex justify-between text-[10px] mt-1">
            <span className="text-emerald-400 font-mono">{(odds.whiteWinProb * 100).toFixed(0)}%</span>
            <span className="text-red-400 font-mono">{(odds.blackWinProb * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {lastMove && (
        <div className="mt-2 bg-black/30 rounded-lg px-3 py-2 text-xs">
          <span className="text-amber-400 font-mono font-bold">{lastMove.san}</span>
          <span className="text-zinc-500 ml-2">{lastMove.comment?.slice(0, 50)}</span>
        </div>
      )}

      <div className="text-center mt-2 text-[10px] text-zinc-700 group-hover:text-zinc-400 transition-colors">
        Click for full view
      </div>
    </div>
  );
}

/* ============ POKER CARD ============ */
function PokerCard({
  game,
  router,
}: {
  game: PokerGame;
  router: ReturnType<typeof useRouter>;
}) {
  let players: Array<{ name: string; avatar: string; chips: number; folded: boolean }> = [];
  let state: { phase?: string; pot?: number; communityCards?: string[]; actions?: Array<{ agent: string; action: string; amount?: number }> } = {};

  try { players = JSON.parse(game.players); } catch { /* skip */ }
  try { state = JSON.parse(game.state); } catch { /* skip */ }

  const cardSymbol = (card: string) => {
    if (!card) return card;
    return card.replace("h", "♥").replace("d", "♦").replace("c", "♣").replace("s", "♠");
  };

  return (
    <div
      onClick={() => router.push("/poker")}
      className="glass rounded-xl p-4 cursor-pointer hover:border-amber-500/20 border border-transparent transition-all group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
          <span className="text-red-400 text-[10px] font-bold uppercase">Live</span>
          <span className="text-zinc-600 text-[10px]">🃏 Poker</span>
        </div>
        {state.phase && (
          <span className="text-amber-400 text-[10px] font-bold uppercase">{state.phase}</span>
        )}
      </div>

      {/* Players */}
      <div className="flex flex-wrap gap-2 mb-3">
        {players.map((p, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${
              p.folded ? "bg-zinc-800/50 opacity-40" : "bg-white/5"
            }`}
          >
            <span className="text-lg">{p.avatar}</span>
            <div>
              <div className="font-bold text-white text-[11px]">{p.name}</div>
              <div className="text-zinc-500 font-mono text-[10px]">{p.chips} chips</div>
            </div>
          </div>
        ))}
      </div>

      {/* Community cards + pot */}
      <div className="bg-emerald-900/20 border border-emerald-500/10 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-center gap-2 min-h-[40px]">
          {(state.communityCards && state.communityCards.length > 0) ? (
            state.communityCards.map((card, i) => (
              <span key={i} className="text-lg font-mono font-bold text-white bg-white/10 px-2 py-1 rounded">
                {cardSymbol(card)}
              </span>
            ))
          ) : (
            <span className="text-zinc-600 text-xs">Waiting for cards...</span>
          )}
        </div>
        {state.pot !== undefined && (
          <div className="text-center mt-2 text-amber-400 font-mono font-bold text-sm">
            Pot: {state.pot}
          </div>
        )}
      </div>

      {/* Recent action */}
      {state.actions && state.actions.length > 0 && (
        <div className="bg-black/30 rounded-lg px-3 py-2 text-xs">
          <span className="text-amber-400 font-bold">{state.actions[state.actions.length - 1].agent}</span>
          <span className="text-zinc-500 ml-1">
            {state.actions[state.actions.length - 1].action}
            {state.actions[state.actions.length - 1].amount ? ` ${state.actions[state.actions.length - 1].amount}` : ""}
          </span>
        </div>
      )}

      <div className="text-center mt-2 text-[10px] text-zinc-700 group-hover:text-zinc-400 transition-colors">
        Click for full view
      </div>
    </div>
  );
}

/* ============ BATTLEGROUND CARD ============ */
function BattlegroundCard({
  game,
  router,
}: {
  game: BattlegroundGame;
  router: ReturnType<typeof useRouter>;
}) {
  let teamA: Array<{ name: string; avatar: string }> = [];
  let teamB: Array<{ name: string; avatar: string }> = [];
  let state: { phase?: string; currentTurn?: number; maxTurns?: number; teamACells?: number; teamBCells?: number; recentActions?: Array<{ agent: string; action: string }> } = {};

  try { teamA = JSON.parse(game.team_a); } catch { /* skip */ }
  try { teamB = JSON.parse(game.team_b); } catch { /* skip */ }
  try { state = JSON.parse(game.state); } catch { /* skip */ }

  const total = (state.teamACells ?? 0) + (state.teamBCells ?? 0);
  const aPct = total > 0 ? ((state.teamACells ?? 0) / total) * 100 : 50;

  return (
    <div
      onClick={() => router.push("/battleground")}
      className="glass rounded-xl p-4 cursor-pointer hover:border-amber-500/20 border border-transparent transition-all group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
          <span className="text-red-400 text-[10px] font-bold uppercase">Live</span>
          <span className="text-zinc-600 text-[10px]">⚔️ Battleground</span>
        </div>
        {state.currentTurn !== undefined && (
          <span className="text-zinc-500 text-xs font-mono">
            Turn {state.currentTurn}/{state.maxTurns ?? "?"}
          </span>
        )}
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex gap-1 mb-1">
            {teamA.map((a, i) => (
              <span key={i} className="text-lg" title={a.name}>{a.avatar}</span>
            ))}
          </div>
          <div className="text-[10px] text-blue-400 font-bold uppercase">Team A</div>
        </div>
        <div className="text-2xl font-black text-zinc-700">VS</div>
        <div className="text-right">
          <div className="flex gap-1 mb-1 justify-end">
            {teamB.map((a, i) => (
              <span key={i} className="text-lg" title={a.name}>{a.avatar}</span>
            ))}
          </div>
          <div className="text-[10px] text-red-400 font-bold uppercase">Team B</div>
        </div>
      </div>

      {/* Territory bar */}
      <div className="mb-3">
        <div className="flex h-3 rounded-full overflow-hidden bg-zinc-800">
          <div
            className="bg-blue-500 transition-all duration-700"
            style={{ width: `${aPct}%` }}
          />
          <div
            className="bg-red-500 transition-all duration-700"
            style={{ width: `${100 - aPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] mt-1">
          <span className="text-blue-400 font-mono">{state.teamACells ?? 0} cells</span>
          <span className="text-red-400 font-mono">{state.teamBCells ?? 0} cells</span>
        </div>
      </div>

      {/* Recent action */}
      {state.recentActions && state.recentActions.length > 0 && (
        <div className="bg-black/30 rounded-lg px-3 py-2 text-xs">
          <span className="text-amber-400 font-bold">
            {state.recentActions[state.recentActions.length - 1].agent}
          </span>
          <span className="text-zinc-500 ml-1">
            {state.recentActions[state.recentActions.length - 1].action}
          </span>
        </div>
      )}

      <div className="text-center mt-2 text-[10px] text-zinc-700 group-hover:text-zinc-400 transition-colors">
        Click for full view
      </div>
    </div>
  );
}
