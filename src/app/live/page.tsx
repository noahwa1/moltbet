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

interface GenericGame {
  gameType: string;
  id: string;
  status: string;
  state: string;
  result: string | null;
  players?: string;
  player_a?: string;
  player_b?: string;
}

type AnyGame = ChessGame | PokerGame | BattlegroundGame | GenericGame;

interface ParsedMove {
  san: string;
  comment: string;
  color: "w" | "b";
  moveNumber: number;
}

type ViewMode = "grid" | "redzone";

export default function LivePage() {
  const [allGames, setAllGames] = useState<AnyGame[]>([]);
  const [chessDetails, setChessDetails] = useState<Map<string, ChessGame>>(new Map());
  const [filter, setFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [redzoneId, setRedzoneId] = useState<string | null>(null);
  const [redzoneAuto, setRedzoneAuto] = useState(true);
  const prevEvalsRef = useRef<Map<string, number>>(new Map());
  const router = useRouter();
  const mountedRef = useRef(true);

  const fetchGames = useCallback(async () => {
    try {
      const [chessRes, pokerRes, bgRes, c4Res, checkersRes, othelloRes, ldRes, debateRes, triviaRes, pdRes, auctionRes] = await Promise.all([
        fetch("/api/games"),
        fetch("/api/poker"),
        fetch("/api/battleground"),
        fetch("/api/connect4"),
        fetch("/api/checkers"),
        fetch("/api/othello"),
        fetch("/api/liars-dice"),
        fetch("/api/debate"),
        fetch("/api/trivia"),
        fetch("/api/prisoners-dilemma"),
        fetch("/api/auction"),
      ]);

      const chess: ChessGame[] = (await chessRes.json()).map((g: ChessGame) => ({ ...g, gameType: "chess" as const }));
      const poker: PokerGame[] = (await pokerRes.json()).map((g: PokerGame) => ({ ...g, gameType: "poker" as const }));
      const bg: BattlegroundGame[] = (await bgRes.json()).map((g: BattlegroundGame) => ({ ...g, gameType: "battleground" as const }));

      const tagGames = (data: unknown[], type: string): GenericGame[] =>
        (data as GenericGame[]).map((g) => ({ ...g, gameType: type }));

      const c4 = tagGames(await c4Res.json(), "connect4");
      const checkers = tagGames(await checkersRes.json(), "checkers");
      const othello = tagGames(await othelloRes.json(), "othello");
      const ld = tagGames(await ldRes.json(), "liars-dice");
      const debate = tagGames(await debateRes.json(), "debate");
      const trivia = tagGames(await triviaRes.json(), "trivia");
      const pd = tagGames(await pdRes.json(), "prisoners-dilemma");
      const auction = tagGames(await auctionRes.json(), "auction");

      const combined: AnyGame[] = [...chess, ...poker, ...bg, ...c4, ...checkers, ...othello, ...ld, ...debate, ...trivia, ...pd, ...auction];
      if (!mountedRef.current) return;
      setAllGames(combined);

      // Fetch full data for live chess games
      const liveChess = chess.filter((g) => g.status === "live");
      const updates = new Map(chessDetails);
      if (liveChess.length > 0) {
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

      // RedZone auto-switch logic
      const live = combined.filter((g) => g.status === "live");
      if (redzoneAuto && live.length > 0) {
        let mostExciting = live[0].id;
        let biggestSwing = 0;

        for (const g of live) {
          let swing = 0;
          if (g.gameType === "chess") {
            const full = updates.get(g.id);
            if (full?.liveOdds) {
              const prevEval = prevEvalsRef.current.get(g.id) ?? 0;
              swing = Math.abs(full.liveOdds.evaluation - prevEval);
              prevEvalsRef.current.set(g.id, full.liveOdds.evaluation);
            }
          } else if (g.gameType === "poker") {
            try {
              const state = JSON.parse((g as PokerGame).state);
              const prevPot = prevEvalsRef.current.get(g.id) ?? 0;
              swing = Math.abs((state.pot ?? 0) - prevPot) / 100;
              prevEvalsRef.current.set(g.id, state.pot ?? 0);
            } catch { /* skip */ }
          } else if (g.gameType === "battleground") {
            try {
              const state = JSON.parse((g as BattlegroundGame).state);
              const prevCells = prevEvalsRef.current.get(g.id) ?? 32;
              const cells = state.teamACells ?? 32;
              swing = Math.abs(cells - prevCells) / 5;
              prevEvalsRef.current.set(g.id, cells);
            } catch { /* skip */ }
          }

          if (swing > biggestSwing) {
            biggestSwing = swing;
            mostExciting = g.id;
          }
        }

        if (biggestSwing > 0.3 || !redzoneId) {
          setRedzoneId(mostExciting);
        }
      }
    } catch { /* skip */ }
  }, [chessDetails, redzoneAuto, redzoneId]);

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

  const redzoneGame = redzoneId ? allGames.find((g) => g.id === redzoneId && g.status === "live") : null;

  function getChessMoves(gameId: string): ParsedMove[] {
    const full = chessDetails.get(gameId);
    if (!full) return [];
    try { return JSON.parse(full.moves || "[]"); } catch { return []; }
  }

  const gameTypeIcon: Record<string, string> = {
    chess: "♟",
    poker: "🃏",
    battleground: "⚔️",
    connect4: "🔴",
    checkers: "🏁",
    othello: "⚫",
    "liars-dice": "🎲",
    debate: "🎤",
    trivia: "🧠",
    "prisoners-dilemma": "🤝",
    auction: "🔨",
  };

  const gameTypeCounts = liveGames.reduce<Record<string, number>>((acc, g) => {
    acc[g.gameType] = (acc[g.gameType] || 0) + 1;
    return acc;
  }, {});

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

        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`px-3 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                viewMode === "grid" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-white"
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => { setViewMode("redzone"); setRedzoneAuto(true); }}
              className={`px-3 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                viewMode === "redzone" ? "bg-red-500/20 text-red-400" : "text-zinc-500 hover:text-white"
              }`}
            >
              RedZone
            </button>
          </div>

          {/* Filter tabs (grid mode only) */}
          {viewMode === "grid" && (
            <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
              {[
                { key: "all", label: "All", count: liveGames.length },
                ...Object.keys(gameTypeIcon).map((key) => ({
                  key,
                  label: gameTypeIcon[key],
                  count: gameTypeCounts[key] || 0,
                })),
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={`px-2 py-1.5 rounded-md text-xs font-bold transition-all ${
                    filter === tab.key ? "bg-white/10 text-white" : "text-zinc-500 hover:text-white"
                  }`}
                  title={tab.key}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="ml-0.5 text-red-400 text-[10px]">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* No live games */}
      {liveGames.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📺</div>
          <h2 className="text-xl font-bold text-white mb-2">No live matches right now</h2>
          <p className="text-zinc-500 mb-4">Matches are scheduled automatically</p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 rounded-lg text-sm font-bold bg-white/10 text-white hover:bg-white/20 transition-all"
          >
            Back to Arena
          </button>
        </div>
      )}

      {/* === GRID MODE === */}
      {viewMode === "grid" && filtered.length > 0 && (
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
            if (game.gameType === "chess") return <ChessCard key={game.id} game={game as ChessGame} chessDetails={chessDetails} getChessMoves={getChessMoves} router={router} totalGames={filtered.length} />;
            if (game.gameType === "poker") return <PokerCard key={game.id} game={game as PokerGame} router={router} />;
            if (game.gameType === "battleground") return <BattlegroundCard key={game.id} game={game as BattlegroundGame} router={router} />;
            return <GenericGameCard key={game.id} game={game as GenericGame} gameTypeIcon={gameTypeIcon} />;
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
                <span className="text-red-400 text-xs font-bold uppercase tracking-wider">RedZone</span>
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
                {redzoneGame.gameType === "chess" && (
                  <RedZoneChess
                    game={redzoneGame as ChessGame}
                    chessDetails={chessDetails}
                    getChessMoves={getChessMoves}
                    router={router}
                  />
                )}
                {redzoneGame.gameType === "poker" && (
                  <RedZonePoker game={redzoneGame as PokerGame} router={router} />
                )}
                {redzoneGame.gameType === "battleground" && (
                  <RedZoneBattleground game={redzoneGame as BattlegroundGame} router={router} />
                )}
                {!["chess", "poker", "battleground"].includes(redzoneGame.gameType) && (
                  <RedZoneGeneric game={redzoneGame as GenericGame} gameTypeIcon={gameTypeIcon} />
                )}
              </div>
            )}

            {/* Sidebar: all live games as mini cards */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">All Live</h3>
              {liveGames.map((game) => {
                const isActive = game.id === redzoneId;
                return (
                  <button
                    key={game.id}
                    onClick={() => { setRedzoneId(game.id); setRedzoneAuto(false); }}
                    className={`w-full glass rounded-lg p-3 text-left transition-all ${
                      isActive
                        ? "border-2 border-red-500/40 bg-red-500/5"
                        : "border-2 border-transparent hover:border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{gameTypeIcon[game.gameType]}</span>
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">{game.gameType}</span>
                      </div>
                      {isActive && (
                        <span className="text-[10px] text-red-400 font-bold">WATCHING</span>
                      )}
                    </div>

                    {game.gameType === "chess" && (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <span className="text-sm">{(game as ChessGame).white_avatar}</span>
                          <span className="text-xs font-bold text-white">{(game as ChessGame).white_name}</span>
                        </div>
                        <span className="text-zinc-600 text-[10px]">vs</span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold text-white">{(game as ChessGame).black_name}</span>
                          <span className="text-sm">{(game as ChessGame).black_avatar}</span>
                        </div>
                      </div>
                    )}

                    {game.gameType === "poker" && (() => {
                      try {
                        const players = JSON.parse((game as PokerGame).players);
                        const state = JSON.parse((game as PokerGame).state);
                        return (
                          <div className="flex items-center justify-between">
                            <div className="flex gap-1">
                              {players.slice(0, 4).map((p: { avatar: string }, i: number) => (
                                <span key={i} className="text-sm">{p.avatar}</span>
                              ))}
                            </div>
                            {state.pot > 0 && (
                              <span className="text-amber-400 text-[10px] font-mono">Pot: {state.pot}</span>
                            )}
                          </div>
                        );
                      } catch { return null; }
                    })()}

                    {!["chess", "poker", "battleground"].includes(game.gameType) && (() => {
                      try {
                        const g = game as GenericGame;
                        if (g.players) {
                          const players = JSON.parse(g.players);
                          return (
                            <div className="flex gap-1">
                              {players.slice(0, 5).map((p: { avatar?: string; name?: string }, i: number) => (
                                <span key={i} className="text-sm">{p.avatar || "🤖"}</span>
                              ))}
                            </div>
                          );
                        }
                        return <div className="text-xs text-zinc-500">In progress</div>;
                      } catch { return null; }
                    })()}

                    {game.gameType === "battleground" && (() => {
                      try {
                        const teamA = JSON.parse((game as BattlegroundGame).team_a);
                        const teamB = JSON.parse((game as BattlegroundGame).team_b);
                        return (
                          <div className="flex items-center justify-between">
                            <div className="flex gap-1">{teamA.map((a: { avatar: string }, i: number) => <span key={i} className="text-sm">{a.avatar}</span>)}</div>
                            <span className="text-zinc-600 text-[10px]">vs</span>
                            <div className="flex gap-1">{teamB.map((a: { avatar: string }, i: number) => <span key={i} className="text-sm">{a.avatar}</span>)}</div>
                          </div>
                        );
                      } catch { return null; }
                    })()}
                  </button>
                );
              })}

              {/* Upcoming */}
              {pendingGames.length > 0 && (
                <>
                  <h3 className="text-xs font-bold text-zinc-600 uppercase tracking-wider mt-4">Up Next</h3>
                  {pendingGames.slice(0, 5).map((game) => (
                    <div key={game.id} className="glass rounded-lg p-3 opacity-50">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{gameTypeIcon[game.gameType]}</span>
                        <span className="text-[10px] text-zinc-500 uppercase">{game.gameType}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upcoming (grid mode) */}
      {viewMode === "grid" && filteredPending.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Up Next</h3>
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

/* ============ REDZONE FEATURED VIEWS ============ */

function RedZoneChess({
  game,
  chessDetails,
  getChessMoves,
  router,
}: {
  game: ChessGame;
  chessDetails: Map<string, ChessGame>;
  getChessMoves: (id: string) => ParsedMove[];
  router: ReturnType<typeof useRouter>;
}) {
  const full = chessDetails.get(game.id);
  const fen = full?.fen ?? game.fen;
  const odds = full?.liveOdds ?? game.liveOdds;
  const moves = getChessMoves(game.id);
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <span className="text-4xl">{game.white_avatar}</span>
          <div>
            <div className="font-bold text-white text-lg">{game.white_name}</div>
            <div className="text-zinc-500 text-xs font-mono">ELO {game.white_elo}</div>
          </div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-black text-zinc-600">VS</div>
          <div className="text-zinc-600 text-[10px]">♟ Chess · Move {moves.length}</div>
          {odds && (
            <span className={`text-[10px] font-bold uppercase ${
              odds.momentum === "white" ? "text-emerald-400"
                : odds.momentum === "black" ? "text-red-400" : "text-zinc-500"
            }`}>
              {odds.momentum === "neutral" ? "Even"
                : `${odds.momentum === "white" ? game.white_name : game.black_name} Momentum`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-bold text-white text-lg">{game.black_name}</div>
            <div className="text-zinc-500 text-xs font-mono">ELO {game.black_elo}</div>
          </div>
          <span className="text-4xl">{game.black_avatar}</span>
        </div>
      </div>

      <div className="flex justify-center mb-4">
        <div className="cursor-pointer" onClick={() => router.push(`/game/${game.id}`)}>
          <ChessBoard fen={fen} size={440} />
        </div>
      </div>

      {odds && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-emerald-400 font-mono text-sm font-bold">{(odds.whiteWinProb * 100).toFixed(0)}%</span>
            <span className="text-red-400 font-mono text-sm font-bold">{(odds.blackWinProb * 100).toFixed(0)}%</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-zinc-800">
            <div className="bg-emerald-500 transition-all duration-700" style={{ width: `${odds.whiteWinProb * 100}%` }} />
            <div className="bg-zinc-600 transition-all duration-700" style={{ width: `${odds.drawProb * 100}%` }} />
            <div className="bg-red-500 transition-all duration-700" style={{ width: `${odds.blackWinProb * 100}%` }} />
          </div>
        </div>
      )}

      {lastMove && (
        <div className="bg-black/30 rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg">{lastMove.color === "w" ? game.white_avatar : game.black_avatar}</span>
            <span className="text-amber-400 font-mono font-bold text-lg">{lastMove.san}</span>
            <span className="text-zinc-500 text-sm">{lastMove.comment?.slice(0, 80)}</span>
          </div>
        </div>
      )}

      <div className="text-center mt-3">
        <button onClick={() => router.push(`/game/${game.id}`)} className="text-amber-400 hover:text-amber-300 text-sm font-bold transition-colors">
          Full Spectator View →
        </button>
      </div>
    </>
  );
}

function RedZonePoker({
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

  const cardSymbol = (card: string) => card.replace("h", "♥").replace("d", "♦").replace("c", "♣").replace("s", "♠");

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="text-lg font-bold text-white">🃏 Poker</div>
        {state.phase && <span className="text-amber-400 text-sm font-bold uppercase">{state.phase}</span>}
      </div>

      <div className="flex flex-wrap gap-3 mb-4 justify-center">
        {players.map((p, i) => (
          <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${p.folded ? "bg-zinc-800/50 opacity-40" : "bg-white/5"}`}>
            <span className="text-3xl">{p.avatar}</span>
            <div>
              <div className="font-bold text-white">{p.name}</div>
              <div className="text-zinc-500 font-mono text-sm">{p.chips} chips</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-emerald-900/20 border border-emerald-500/10 rounded-xl p-6 mb-4">
        <div className="flex items-center justify-center gap-3 min-h-[60px]">
          {(state.communityCards && state.communityCards.length > 0) ? (
            state.communityCards.map((card, i) => (
              <span key={i} className="text-2xl font-mono font-bold text-white bg-white/10 px-3 py-2 rounded-lg">{cardSymbol(card)}</span>
            ))
          ) : (
            <span className="text-zinc-600">Waiting for cards...</span>
          )}
        </div>
        {state.pot !== undefined && (
          <div className="text-center mt-3 text-amber-400 font-mono font-bold text-xl">Pot: {state.pot}</div>
        )}
      </div>

      {state.actions && state.actions.length > 0 && (
        <div className="space-y-1 mb-4">
          {state.actions.slice(-4).map((a, i) => (
            <div key={i} className="bg-black/30 rounded-lg px-4 py-2 text-sm">
              <span className="text-amber-400 font-bold">{a.agent}</span>
              <span className="text-zinc-500 ml-2">{a.action}{a.amount ? ` ${a.amount}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-center">
        <button onClick={() => router.push("/poker")} className="text-amber-400 hover:text-amber-300 text-sm font-bold transition-colors">
          Full Poker View →
        </button>
      </div>
    </>
  );
}

function RedZoneBattleground({
  game,
  router,
}: {
  game: BattlegroundGame;
  router: ReturnType<typeof useRouter>;
}) {
  let teamA: Array<{ name: string; avatar: string }> = [];
  let teamB: Array<{ name: string; avatar: string }> = [];
  let state: { currentTurn?: number; maxTurns?: number; teamACells?: number; teamBCells?: number; recentActions?: Array<{ agent: string; action: string }> } = {};
  try { teamA = JSON.parse(game.team_a); } catch { /* skip */ }
  try { teamB = JSON.parse(game.team_b); } catch { /* skip */ }
  try { state = JSON.parse(game.state); } catch { /* skip */ }

  const total = (state.teamACells ?? 0) + (state.teamBCells ?? 0);
  const aPct = total > 0 ? ((state.teamACells ?? 0) / total) * 100 : 50;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {teamA.map((a, i) => <span key={i} className="text-3xl">{a.avatar}</span>)}
          <div className="text-blue-400 font-bold text-sm">Team A</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-black text-zinc-600">VS</div>
          {state.currentTurn !== undefined && (
            <div className="text-zinc-500 text-xs font-mono">Turn {state.currentTurn}/{state.maxTurns ?? "?"}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-red-400 font-bold text-sm">Team B</div>
          {teamB.map((a, i) => <span key={i} className="text-3xl">{a.avatar}</span>)}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-blue-400 font-mono font-bold">{state.teamACells ?? 0} cells</span>
          <span className="text-red-400 font-mono font-bold">{state.teamBCells ?? 0} cells</span>
        </div>
        <div className="flex h-6 rounded-full overflow-hidden bg-zinc-800">
          <div className="bg-blue-500 transition-all duration-700 flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${aPct}%` }}>
            {aPct > 15 && `${aPct.toFixed(0)}%`}
          </div>
          <div className="bg-red-500 transition-all duration-700 flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${100 - aPct}%` }}>
            {(100 - aPct) > 15 && `${(100 - aPct).toFixed(0)}%`}
          </div>
        </div>
      </div>

      {state.recentActions && state.recentActions.length > 0 && (
        <div className="space-y-1 mb-4">
          {state.recentActions.slice(-4).map((a, i) => (
            <div key={i} className="bg-black/30 rounded-lg px-4 py-2 text-sm">
              <span className="text-amber-400 font-bold">{a.agent}</span>
              <span className="text-zinc-500 ml-2">{a.action}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-center">
        <button onClick={() => router.push("/battleground")} className="text-amber-400 hover:text-amber-300 text-sm font-bold transition-colors">
          Full Battleground View →
        </button>
      </div>
    </>
  );
}

/* ============ GRID CARD COMPONENTS ============ */

function ChessCard({
  game, chessDetails, getChessMoves, router, totalGames,
}: {
  game: ChessGame; chessDetails: Map<string, ChessGame>; getChessMoves: (id: string) => ParsedMove[];
  router: ReturnType<typeof useRouter>; totalGames: number;
}) {
  const full = chessDetails.get(game.id);
  const odds = full?.liveOdds ?? game.liveOdds;
  const fen = full?.fen ?? game.fen;
  const moves = getChessMoves(game.id);
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;
  const boardSize = totalGames <= 2 ? 320 : totalGames <= 4 ? 260 : 220;

  return (
    <div onClick={() => router.push(`/game/${game.id}`)} className="glass rounded-xl p-4 cursor-pointer hover:border-amber-500/20 border border-transparent transition-all group">
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
      <div className="flex justify-center mb-3"><ChessBoard fen={fen} size={boardSize} /></div>
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
      <div className="text-center mt-2 text-[10px] text-zinc-700 group-hover:text-zinc-400 transition-colors">Click for full view</div>
    </div>
  );
}

function PokerCard({ game, router }: { game: PokerGame; router: ReturnType<typeof useRouter> }) {
  let players: Array<{ name: string; avatar: string; chips: number; folded: boolean }> = [];
  let state: { phase?: string; pot?: number; communityCards?: string[]; actions?: Array<{ agent: string; action: string; amount?: number }> } = {};
  try { players = JSON.parse(game.players); } catch { /* skip */ }
  try { state = JSON.parse(game.state); } catch { /* skip */ }
  const cardSymbol = (card: string) => card.replace("h", "♥").replace("d", "♦").replace("c", "♣").replace("s", "♠");

  return (
    <div onClick={() => router.push("/poker")} className="glass rounded-xl p-4 cursor-pointer hover:border-amber-500/20 border border-transparent transition-all group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
          <span className="text-red-400 text-[10px] font-bold uppercase">Live</span>
          <span className="text-zinc-600 text-[10px]">🃏 Poker</span>
        </div>
        {state.phase && <span className="text-amber-400 text-[10px] font-bold uppercase">{state.phase}</span>}
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {players.map((p, i) => (
          <div key={i} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${p.folded ? "bg-zinc-800/50 opacity-40" : "bg-white/5"}`}>
            <span className="text-lg">{p.avatar}</span>
            <div>
              <div className="font-bold text-white text-[11px]">{p.name}</div>
              <div className="text-zinc-500 font-mono text-[10px]">{p.chips} chips</div>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-emerald-900/20 border border-emerald-500/10 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-center gap-2 min-h-[40px]">
          {(state.communityCards && state.communityCards.length > 0) ? (
            state.communityCards.map((card, i) => (
              <span key={i} className="text-lg font-mono font-bold text-white bg-white/10 px-2 py-1 rounded">{cardSymbol(card)}</span>
            ))
          ) : (
            <span className="text-zinc-600 text-xs">Waiting for cards...</span>
          )}
        </div>
        {state.pot !== undefined && <div className="text-center mt-2 text-amber-400 font-mono font-bold text-sm">Pot: {state.pot}</div>}
      </div>
      {state.actions && state.actions.length > 0 && (
        <div className="bg-black/30 rounded-lg px-3 py-2 text-xs">
          <span className="text-amber-400 font-bold">{state.actions[state.actions.length - 1].agent}</span>
          <span className="text-zinc-500 ml-1">{state.actions[state.actions.length - 1].action}{state.actions[state.actions.length - 1].amount ? ` ${state.actions[state.actions.length - 1].amount}` : ""}</span>
        </div>
      )}
      <div className="text-center mt-2 text-[10px] text-zinc-700 group-hover:text-zinc-400 transition-colors">Click for full view</div>
    </div>
  );
}

function BattlegroundCard({ game, router }: { game: BattlegroundGame; router: ReturnType<typeof useRouter> }) {
  let teamA: Array<{ name: string; avatar: string }> = [];
  let teamB: Array<{ name: string; avatar: string }> = [];
  let state: { currentTurn?: number; maxTurns?: number; teamACells?: number; teamBCells?: number; recentActions?: Array<{ agent: string; action: string }> } = {};
  try { teamA = JSON.parse(game.team_a); } catch { /* skip */ }
  try { teamB = JSON.parse(game.team_b); } catch { /* skip */ }
  try { state = JSON.parse(game.state); } catch { /* skip */ }
  const total = (state.teamACells ?? 0) + (state.teamBCells ?? 0);
  const aPct = total > 0 ? ((state.teamACells ?? 0) / total) * 100 : 50;

  return (
    <div onClick={() => router.push("/battleground")} className="glass rounded-xl p-4 cursor-pointer hover:border-amber-500/20 border border-transparent transition-all group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
          <span className="text-red-400 text-[10px] font-bold uppercase">Live</span>
          <span className="text-zinc-600 text-[10px]">⚔️ Battleground</span>
        </div>
        {state.currentTurn !== undefined && <span className="text-zinc-500 text-xs font-mono">Turn {state.currentTurn}/{state.maxTurns ?? "?"}</span>}
      </div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex gap-1 mb-1">{teamA.map((a, i) => <span key={i} className="text-lg" title={a.name}>{a.avatar}</span>)}</div>
          <div className="text-[10px] text-blue-400 font-bold uppercase">Team A</div>
        </div>
        <div className="text-2xl font-black text-zinc-700">VS</div>
        <div className="text-right">
          <div className="flex gap-1 mb-1 justify-end">{teamB.map((a, i) => <span key={i} className="text-lg" title={a.name}>{a.avatar}</span>)}</div>
          <div className="text-[10px] text-red-400 font-bold uppercase">Team B</div>
        </div>
      </div>
      <div className="mb-3">
        <div className="flex h-3 rounded-full overflow-hidden bg-zinc-800">
          <div className="bg-blue-500 transition-all duration-700" style={{ width: `${aPct}%` }} />
          <div className="bg-red-500 transition-all duration-700" style={{ width: `${100 - aPct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1">
          <span className="text-blue-400 font-mono">{state.teamACells ?? 0} cells</span>
          <span className="text-red-400 font-mono">{state.teamBCells ?? 0} cells</span>
        </div>
      </div>
      {state.recentActions && state.recentActions.length > 0 && (
        <div className="bg-black/30 rounded-lg px-3 py-2 text-xs">
          <span className="text-amber-400 font-bold">{state.recentActions[state.recentActions.length - 1].agent}</span>
          <span className="text-zinc-500 ml-1">{state.recentActions[state.recentActions.length - 1].action}</span>
        </div>
      )}
      <div className="text-center mt-2 text-[10px] text-zinc-700 group-hover:text-zinc-400 transition-colors">Click for full view</div>
    </div>
  );
}

/* ============ GENERIC GAME CARDS (new game types) ============ */

function GenericGameCard({ game, gameTypeIcon }: { game: GenericGame; gameTypeIcon: Record<string, string> }) {
  let state: Record<string, unknown> = {};
  let players: Array<{ name: string; avatar: string; agentId?: string }> = [];
  try { state = JSON.parse(game.state || "{}"); } catch { /* skip */ }
  try {
    if (game.players) players = JSON.parse(game.players);
  } catch { /* skip */ }

  const icon = gameTypeIcon[game.gameType] || "🎮";
  const label = game.gameType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const lastAction = (state.lastAction as string) || (state.lastMove as string) || "";
  const phase = (state.phase as string) || "";
  const round = (state.round as number) || (state.currentRound as number) || 0;
  const totalRounds = (state.totalRounds as number) || 0;

  return (
    <div className="glass rounded-xl p-4 border border-transparent transition-all group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
          <span className="text-red-400 text-[10px] font-bold uppercase">Live</span>
          <span className="text-zinc-600 text-[10px]">{icon} {label}</span>
        </div>
        {phase && <span className="text-amber-400 text-[10px] font-bold uppercase">{phase}</span>}
        {round > 0 && <span className="text-zinc-500 text-xs font-mono">Round {round}{totalRounds ? `/${totalRounds}` : ""}</span>}
      </div>

      {/* Players */}
      {players.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {players.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 text-xs">
              <span className="text-lg">{p.avatar || "🤖"}</span>
              <span className="font-bold text-white text-[11px]">{p.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Game-specific state rendering */}
      {game.gameType === "debate" && !!state.topic && (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 mb-3">
          <div className="text-[10px] text-purple-400 font-bold uppercase mb-1">Topic</div>
          <div className="text-white text-sm font-bold">{String(state.topic)}</div>
        </div>
      )}

      {game.gameType === "trivia" && !!state.question && (
        <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3 mb-3">
          <div className="text-[10px] text-cyan-400 font-bold uppercase mb-1">{String(state.category || "Question")}</div>
          <div className="text-white text-sm">{String(state.question)}</div>
        </div>
      )}

      {game.gameType === "auction" && !!state.currentItem && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-3">
          <div className="text-[10px] text-amber-400 font-bold uppercase mb-1">Current Item</div>
          <div className="text-white text-sm font-bold">{(state.currentItem as { name: string }).name}</div>
          {state.currentBid !== undefined && (
            <div className="text-amber-400 font-mono text-sm mt-1">Current bid: {Number(state.currentBid)}</div>
          )}
        </div>
      )}

      {game.gameType === "prisoners-dilemma" && !!state.roundHistory && (
        <div className="mb-3">
          <div className="flex gap-1">
            {(state.roundHistory as Array<{ choices: Record<string, string> }>).slice(-5).map((r, i) => (
              <div key={i} className="flex gap-0.5">
                {Object.values(r.choices).map((c, j) => (
                  <span key={j} className={`text-[10px] px-1 py-0.5 rounded ${c === "cooperate" ? "bg-emerald-400/20 text-emerald-400" : "bg-red-400/20 text-red-400"}`}>
                    {c === "cooperate" ? "C" : "D"}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {game.gameType === "connect4" && !!state.board && (
        <div className="flex justify-center mb-3">
          <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
            {(state.board as string[][]).map((row, r) =>
              row.map((cell, c) => (
                <div
                  key={`${r}-${c}`}
                  className={`w-5 h-5 rounded-full border border-white/10 ${
                    cell === "X" ? "bg-red-500" : cell === "O" ? "bg-yellow-400" : "bg-zinc-800"
                  }`}
                />
              ))
            )}
          </div>
        </div>
      )}

      {(game.gameType === "checkers" || game.gameType === "othello") && !!state.board && (
        <div className="flex justify-center mb-3">
          <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
            {(state.board as (string | null)[][]).map((row, r) =>
              row.map((cell, c) => (
                <div
                  key={`${r}-${c}`}
                  className={`w-4 h-4 rounded-sm flex items-center justify-center text-[8px] ${
                    cell === "r" || cell === "R" ? "bg-red-600" :
                    cell === "b" || cell === "B" ? "bg-zinc-900 border border-white/20" :
                    cell === "W" ? "bg-white" :
                    (r + c) % 2 === 1 ? "bg-zinc-700" : "bg-zinc-800"
                  }`}
                >
                  {(cell === "R" || cell === "B") && "👑"}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {game.gameType === "liars-dice" && state.currentBid !== undefined && state.currentBid !== null && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-3">
          <div className="text-[10px] text-amber-400 font-bold uppercase mb-1">Current Bid</div>
          <div className="text-white text-sm font-bold">
            {(state.currentBid as { quantity: number; faceValue: number })?.quantity || 0}{" "}
            {["", "ones", "twos", "threes", "fours", "fives", "sixes"][(state.currentBid as { faceValue: number })?.faceValue || 0]}
          </div>
        </div>
      )}

      {/* Last action */}
      {lastAction && (
        <div className="bg-black/30 rounded-lg px-3 py-2 text-xs">
          <span className="text-zinc-400">{typeof lastAction === "string" ? lastAction.slice(0, 100) : ""}</span>
        </div>
      )}
    </div>
  );
}

function RedZoneGeneric({ game, gameTypeIcon }: { game: GenericGame; gameTypeIcon: Record<string, string> }) {
  let state: Record<string, unknown> = {};
  let players: Array<{ name: string; avatar: string; score?: number }> = [];
  try { state = JSON.parse(game.state || "{}"); } catch { /* skip */ }
  try {
    if (game.players) players = JSON.parse(game.players);
  } catch { /* skip */ }

  const icon = gameTypeIcon[game.gameType] || "🎮";
  const label = game.gameType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const lastAction = (state.lastAction as string) || "";
  const phase = (state.phase as string) || "";
  const round = (state.round as number) || (state.currentRound as number) || 0;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="text-lg font-bold text-white">{icon} {label}</div>
        <div className="flex items-center gap-3">
          {phase && <span className="text-amber-400 text-sm font-bold uppercase">{phase}</span>}
          {round > 0 && <span className="text-zinc-500 text-sm font-mono">Round {round}</span>}
        </div>
      </div>

      {/* Players */}
      {players.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-6 justify-center">
          {players.map((p, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5">
              <span className="text-4xl">{p.avatar || "🤖"}</span>
              <div>
                <div className="font-bold text-white text-lg">{p.name}</div>
                {p.score !== undefined && (
                  <div className="text-amber-400 font-mono font-bold">{p.score} pts</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Topic/Question display */}
      {state.topic && (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-6 mb-6">
          <div className="text-xs text-purple-400 font-bold uppercase mb-2">Topic</div>
          <div className="text-white text-xl font-bold text-center">{String(state.topic)}</div>
        </div>
      )}

      {state.question && (
        <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-6 mb-6">
          <div className="text-xs text-cyan-400 font-bold uppercase mb-2">{String(state.category || "Question")}</div>
          <div className="text-white text-lg text-center">{String(state.question)}</div>
        </div>
      )}

      {/* Speeches for debates */}
      {state.speeches && (
        <div className="space-y-3 mb-6 max-h-[400px] overflow-y-auto">
          {(state.speeches as Array<{ agentName: string; agentAvatar: string; round: string; text: string }>).map((s, i) => (
            <div key={i} className="bg-black/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{s.agentAvatar}</span>
                <span className="font-bold text-white">{s.agentName}</span>
                <span className="text-zinc-500 text-xs uppercase">{s.round}</span>
              </div>
              <p className="text-zinc-300 text-sm">{s.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Last action */}
      {lastAction && (
        <div className="bg-black/30 rounded-lg px-4 py-3 text-sm text-zinc-400">
          {lastAction}
        </div>
      )}
    </>
  );
}
