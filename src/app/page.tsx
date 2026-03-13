"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ChessBoard from "@/components/ChessBoard";
import OddsSparkline from "@/components/OddsSparkline";

interface Game {
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
  scheduled_at: string;
  odds: { white: number; black: number; draw: number };
  liveOdds?: {
    white: number;
    black: number;
    draw: number;
    whiteWinProb: number;
    blackWinProb: number;
    drawProb: number;
    evaluation: number;
    momentum: "white" | "black" | "neutral";
  } | null;
  oddsHistory?: Array<{
    moveNumber: number;
    white: number;
    black: number;
    evaluation: number;
    timestamp: number;
  }>;
}

interface FeaturedGame extends Game {
  parsedMoves: Array<{
    san: string;
    comment: string;
    color: "w" | "b";
    moveNumber: number;
  }>;
}

interface UserData {
  user: {
    balance: number;
    total_won: number;
    total_lost: number;
    is_new?: boolean;
  };
  bets: Array<{
    id: string;
    game_id: string;
    agent_name: string;
    agent_avatar: string;
    amount: number;
    odds: number;
    status: string;
    payout: number;
  }>;
}

export default function Home() {
  const [games, setGames] = useState<Game[]>([]);
  const [featured, setFeatured] = useState<FeaturedGame | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [quickBet, setQuickBet] = useState<{
    gameId: string;
    agentId: string;
    agentName: string;
    agentAvatar: string;
    odds: number;
  } | null>(null);
  const [betAmount, setBetAmount] = useState(100);
  const [placing, setPlacing] = useState(false);
  const [betSuccess, setBetSuccess] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const router = useRouter();

  const fetchAll = useCallback(async () => {
    const [gamesRes, userRes] = await Promise.all([
      fetch("/api/games"),
      fetch("/api/user"),
    ]);
    const gamesData: Game[] = await gamesRes.json();
    const userDataRes: UserData = await userRes.json();

    setGames(gamesData);
    setUserData(userDataRes);

    // Show welcome for new users (no bets placed yet, full balance)
    if (
      userDataRes.user.balance === 10000 &&
      userDataRes.bets.length === 0 &&
      userDataRes.user.total_won === 0
    ) {
      setShowWelcome(true);
    }

    // Pick featured game: prefer live, then most recent pending
    const live = gamesData.filter((g) => g.status === "live");
    const pending = gamesData.filter((g) => g.status === "pending");
    const finished = gamesData.filter((g) => g.status === "finished");
    const featuredGame = live[0] ?? pending[0] ?? finished[0];

    if (featuredGame) {
      // If it's a live game, also fetch its full data for the board + moves
      if (featuredGame.status === "live") {
        try {
          const fullRes = await fetch(`/api/games/${featuredGame.id}`);
          const fullData = await fullRes.json();
          let parsedMoves: FeaturedGame["parsedMoves"] = [];
          try {
            parsedMoves = JSON.parse(fullData.moves || "[]");
          } catch {
            /* empty */
          }
          setFeatured({
            ...featuredGame,
            fen: fullData.fen,
            moves: fullData.moves,
            liveOdds: fullData.liveOdds,
            oddsHistory: fullData.oddsHistory,
            parsedMoves,
          });
        } catch {
          setFeatured({ ...featuredGame, parsedMoves: [] });
        }
      } else {
        let parsedMoves: FeaturedGame["parsedMoves"] = [];
        try {
          parsedMoves = JSON.parse(featuredGame.moves || "[]");
        } catch {
          /* empty */
        }
        setFeatured({ ...featuredGame, parsedMoves });
      }
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 2000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  async function placeBet() {
    if (!quickBet) return;
    setPlacing(true);
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: quickBet.gameId,
          agentId: quickBet.agentId,
          amount: betAmount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBetSuccess(
        `${betAmount} on ${quickBet.agentName} @ ${quickBet.odds.toFixed(2)}x`
      );
      setQuickBet(null);
      setShowWelcome(false);
      fetchAll();
      setTimeout(() => setBetSuccess(null), 4000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setPlacing(false);
    }
  }

  const liveGames = games.filter((g) => g.status === "live");
  const upcomingGames = games.filter((g) => g.status === "pending");
  const finishedGames = games.filter((g) => g.status === "finished").slice(0, 6);
  const balance = userData?.user?.balance ?? 0;
  const isLive = featured?.status === "live";
  const currentTurn =
    featured?.fen?.split(" ")[1] === "w" ? "white" : "black";
  const odds = featured?.liveOdds ?? featured?.odds;

  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Success toast */}
      {betSuccess && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-500 text-white px-5 py-3 rounded-lg shadow-xl animate-slideUp font-bold">
          Bet placed! {betSuccess}
        </div>
      )}

      {/* Welcome banner for new users */}
      {showWelcome && (
        <div className="mb-6 bg-gradient-to-r from-amber-400/10 via-emerald-400/10 to-teal-400/10 border border-amber-400/20 rounded-2xl p-6 animate-slideUp">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-xl font-black text-white mb-1">
                Welcome to the Arena
              </h2>
              <p className="text-zinc-400 text-sm">
                You have{" "}
                <span className="text-amber-400 font-mono font-bold">
                  10,000 coins
                </span>{" "}
                to play with. Pick a side below and place your first bet — it's
                on us.
              </p>
            </div>
            <button
              onClick={() => setShowWelcome(false)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Quick bet modal */}
      {quickBet && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 animate-slideUp">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl">{quickBet.agentAvatar}</span>
              <div>
                <h3 className="text-lg font-bold text-white">
                  {quickBet.agentName}
                </h3>
                <div className="text-emerald-400 font-mono font-bold">
                  {quickBet.odds.toFixed(2)}x
                </div>
              </div>
            </div>
            <div className="flex gap-2 mb-3 flex-wrap justify-center">
              {[50, 100, 250, 500, 1000].map((q) => (
                <button
                  key={q}
                  onClick={() => setBetAmount(q)}
                  className={`px-3 py-1.5 rounded-md text-sm font-mono transition-all ${
                    betAmount === q
                      ? "bg-amber-400 text-black font-bold"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={10}
              max={Math.min(balance, 5000)}
              step={10}
              value={betAmount}
              onChange={(e) => setBetAmount(parseInt(e.target.value))}
              className="w-full accent-amber-400 mb-2"
            />
            <div className="text-center mb-4">
              <div className="text-2xl font-black text-amber-400 font-mono">
                {betAmount} coins
              </div>
              <div className="text-zinc-500 text-sm">
                Win{" "}
                <span className="text-emerald-400 font-bold font-mono">
                  {Math.round(betAmount * quickBet.odds)}
                </span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setQuickBet(null)}
                className="flex-1 py-3 rounded-lg border border-white/10 text-zinc-400"
              >
                Cancel
              </button>
              <button
                onClick={placeBet}
                disabled={placing}
                className="flex-1 py-3 rounded-lg font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {placing ? "..." : "Place Bet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== FEATURED MATCH HERO ===== */}
      {featured ? (
        <div className="mb-10">
          {/* Status badge */}
          <div className="flex items-center justify-center gap-3 mb-4">
            {isLive ? (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-full px-4 py-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500 live-dot" />
                <span className="text-red-400 text-xs font-bold uppercase tracking-wider">
                  Live Now
                </span>
              </div>
            ) : featured.status === "pending" ? (
              <div className="bg-amber-400/10 border border-amber-400/30 rounded-full px-4 py-1.5">
                <span className="text-amber-400 text-xs font-bold uppercase tracking-wider">
                  Up Next
                </span>
              </div>
            ) : (
              <div className="bg-zinc-700/50 rounded-full px-4 py-1.5">
                <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">
                  Last Match
                </span>
              </div>
            )}
            <span className="text-zinc-600 text-xs">
              {liveGames.length} live · {upcomingGames.length} upcoming
            </span>
          </div>

          {/* Main hero layout */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-start">
            {/* Left: White side + bet */}
            <div className="flex flex-col items-center lg:items-end gap-4">
              <div
                className={`text-center lg:text-right ${
                  isLive && currentTurn === "white" ? "animate-pulse" : ""
                }`}
              >
                <span className="text-6xl block mb-2">
                  {featured.white_avatar}
                </span>
                <div className="font-black text-2xl text-white">
                  {featured.white_name}
                </div>
                <div className="text-zinc-500 text-sm font-mono">
                  ELO {featured.white_elo}
                </div>
                {isLive && currentTurn === "white" && (
                  <div className="mt-2 flex items-center justify-center lg:justify-end gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-emerald-400 text-xs">Thinking...</span>
                  </div>
                )}
              </div>

              {/* White bet button */}
              {featured.status !== "finished" && odds && (
                <button
                  onClick={() =>
                    setQuickBet({
                      gameId: featured.id,
                      agentId: featured.white_id,
                      agentName: featured.white_name,
                      agentAvatar: featured.white_avatar,
                      odds: odds.white,
                    })
                  }
                  className="w-full max-w-[200px] bg-white/5 hover:bg-emerald-400/10 border-2 border-white/10 hover:border-emerald-400/30 rounded-xl px-6 py-4 transition-all group"
                >
                  <div className="text-xs text-zinc-500 group-hover:text-emerald-300 uppercase tracking-wider mb-1">
                    Bet White
                  </div>
                  <div className="font-mono font-black text-emerald-400 text-3xl">
                    {odds.white.toFixed(2)}
                  </div>
                  {featured.liveOdds && (
                    <div className="text-[10px] text-zinc-600 mt-1">
                      {(featured.liveOdds.whiteWinProb * 100).toFixed(0)}% win
                      prob
                    </div>
                  )}
                </button>
              )}

              {/* Live odds sparkline */}
              {featured.oddsHistory && featured.oddsHistory.length > 1 && (
                <div className="w-full max-w-[260px]">
                  <OddsSparkline
                    history={featured.oddsHistory}
                    width={260}
                    height={100}
                  />
                </div>
              )}
            </div>

            {/* Center: Board */}
            <div className="flex flex-col items-center gap-4">
              {featured.fen ? (
                <div
                  className="cursor-pointer"
                  onClick={() => router.push(`/game/${featured.id}`)}
                >
                  <ChessBoard fen={featured.fen} size={400} />
                </div>
              ) : (
                <div
                  className="flex items-center justify-center rounded-lg bg-zinc-900 border border-white/10"
                  style={{ width: 400, height: 400 }}
                >
                  <div className="text-center">
                    <div className="text-6xl mb-3 animate-bounce">♟</div>
                    <div className="text-zinc-500">
                      {featured.status === "pending"
                        ? "Starting soon..."
                        : "Loading..."}
                    </div>
                  </div>
                </div>
              )}

              {/* Result overlay on board */}
              {featured.result && (
                <div
                  className={`text-center -mt-2 font-mono font-black text-2xl px-6 py-2 rounded-lg ${
                    featured.result === "1-0"
                      ? "text-emerald-400 bg-emerald-400/10"
                      : featured.result === "0-1"
                        ? "text-red-400 bg-red-400/10"
                        : "text-zinc-400 bg-zinc-400/10"
                  }`}
                >
                  {featured.result === "1-0"
                    ? `${featured.white_name} Wins`
                    : featured.result === "0-1"
                      ? `${featured.black_name} Wins`
                      : "Draw"}
                </div>
              )}

              {/* Momentum + probability bar */}
              {featured.liveOdds && (
                <div className="w-full max-w-[400px]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-emerald-400 font-mono text-sm font-bold">
                      {(featured.liveOdds.whiteWinProb * 100).toFixed(0)}%
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        featured.liveOdds.momentum === "white"
                          ? "text-emerald-400"
                          : featured.liveOdds.momentum === "black"
                            ? "text-red-400"
                            : "text-zinc-500"
                      }`}
                    >
                      {featured.liveOdds.momentum === "white"
                        ? "White Momentum"
                        : featured.liveOdds.momentum === "black"
                          ? "Black Momentum"
                          : "Even"}
                    </span>
                    <span className="text-red-400 font-mono text-sm font-bold">
                      {(featured.liveOdds.blackWinProb * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-800">
                    <div
                      className="bg-emerald-500 transition-all duration-700"
                      style={{
                        width: `${featured.liveOdds.whiteWinProb * 100}%`,
                      }}
                    />
                    <div
                      className="bg-zinc-600 transition-all duration-700"
                      style={{
                        width: `${featured.liveOdds.drawProb * 100}%`,
                      }}
                    />
                    <div
                      className="bg-red-500 transition-all duration-700"
                      style={{
                        width: `${featured.liveOdds.blackWinProb * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Move counter + link to full game page */}
              <div className="flex items-center gap-4 text-sm">
                {featured.parsedMoves.length > 0 && (
                  <span className="text-zinc-500 font-mono">
                    Move {featured.parsedMoves.length}
                  </span>
                )}
                {isLive && (
                  <button
                    onClick={() => router.push(`/game/${featured.id}`)}
                    className="text-amber-400 hover:text-amber-300 font-bold transition-colors"
                  >
                    Full Spectator View &rarr;
                  </button>
                )}
              </div>

              {/* Latest move comment */}
              {featured.parsedMoves.length > 0 && (
                <div className="glass rounded-xl p-3 w-full max-w-[400px]">
                  <div className="flex items-start gap-3">
                    <span className="text-lg">
                      {featured.parsedMoves[featured.parsedMoves.length - 1]
                        .color === "w"
                        ? featured.white_avatar
                        : featured.black_avatar}
                    </span>
                    <div>
                      <span className="text-amber-400 font-mono font-bold text-sm">
                        {
                          featured.parsedMoves[featured.parsedMoves.length - 1]
                            .san
                        }
                      </span>
                      <span className="text-zinc-500 text-sm ml-2">
                        {featured.parsedMoves[
                          featured.parsedMoves.length - 1
                        ].comment?.slice(0, 80) || ""}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Black side + bet */}
            <div className="flex flex-col items-center lg:items-start gap-4">
              <div
                className={`text-center lg:text-left ${
                  isLive && currentTurn === "black" ? "animate-pulse" : ""
                }`}
              >
                <span className="text-6xl block mb-2">
                  {featured.black_avatar}
                </span>
                <div className="font-black text-2xl text-white">
                  {featured.black_name}
                </div>
                <div className="text-zinc-500 text-sm font-mono">
                  ELO {featured.black_elo}
                </div>
                {isLive && currentTurn === "black" && (
                  <div className="mt-2 flex items-center justify-center lg:justify-start gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-emerald-400 text-xs">Thinking...</span>
                  </div>
                )}
              </div>

              {/* Black bet button */}
              {featured.status !== "finished" && odds && (
                <button
                  onClick={() =>
                    setQuickBet({
                      gameId: featured.id,
                      agentId: featured.black_id,
                      agentName: featured.black_name,
                      agentAvatar: featured.black_avatar,
                      odds: odds.black,
                    })
                  }
                  className="w-full max-w-[200px] bg-white/5 hover:bg-emerald-400/10 border-2 border-white/10 hover:border-emerald-400/30 rounded-xl px-6 py-4 transition-all group"
                >
                  <div className="text-xs text-zinc-500 group-hover:text-emerald-300 uppercase tracking-wider mb-1">
                    Bet Black
                  </div>
                  <div className="font-mono font-black text-emerald-400 text-3xl">
                    {odds.black.toFixed(2)}
                  </div>
                  {featured.liveOdds && (
                    <div className="text-[10px] text-zinc-600 mt-1">
                      {(featured.liveOdds.blackWinProb * 100).toFixed(0)}% win
                      prob
                    </div>
                  )}
                </button>
              )}

              {/* Draw odds */}
              {featured.status !== "finished" && odds && (
                <div className="text-center">
                  <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
                    Draw
                  </div>
                  <div className="font-mono text-zinc-500 font-bold">
                    {odds.draw.toFixed(2)}
                  </div>
                </div>
              )}

              {/* Balance card */}
              <div className="glass rounded-xl p-4 w-full max-w-[200px]">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                  Your Balance
                </div>
                <div className="text-xl font-black text-amber-400 font-mono">
                  {balance.toLocaleString()}
                </div>
                <div className="flex gap-3 mt-1 text-xs font-mono">
                  <span className="text-emerald-400">
                    +{(userData?.user?.total_won ?? 0).toLocaleString()}
                  </span>
                  <span className="text-red-400">
                    -{(userData?.user?.total_lost ?? 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Loading state */
        <div className="text-center py-20 animate-slideUp">
          <div className="text-7xl mb-4 animate-bounce">♟</div>
          <h1 className="text-4xl font-black mb-2">
            <span className="gradient-text">AI Arena</span>
          </h1>
          <p className="text-zinc-500">Setting up the first match...</p>
        </div>
      )}

      {/* ===== UPCOMING MATCHES STRIP ===== */}
      {upcomingGames.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">
            Up Next
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {upcomingGames.map((game) => (
              <div
                key={game.id}
                className="glass rounded-xl p-4 min-w-[280px] flex-shrink-0"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{game.white_avatar}</span>
                    <span className="text-zinc-600 text-xs font-bold">VS</span>
                    <span className="text-xl">{game.black_avatar}</span>
                  </div>
                  <span className="text-amber-400/60 text-xs font-mono">
                    {getTimeUntil(game.scheduled_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-white font-bold">{game.white_name}</span>
                  <span className="text-white font-bold">{game.black_name}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setQuickBet({
                        gameId: game.id,
                        agentId: game.white_id,
                        agentName: game.white_name,
                        agentAvatar: game.white_avatar,
                        odds: game.odds.white,
                      })
                    }
                    className="flex-1 bg-white/5 hover:bg-emerald-400/10 border border-white/10 hover:border-emerald-400/30 rounded-lg py-2 transition-all text-center"
                  >
                    <div className="font-mono font-bold text-emerald-400">
                      {game.odds.white.toFixed(2)}
                    </div>
                  </button>
                  <button
                    onClick={() =>
                      setQuickBet({
                        gameId: game.id,
                        agentId: game.black_id,
                        agentName: game.black_name,
                        agentAvatar: game.black_avatar,
                        odds: game.odds.black,
                      })
                    }
                    className="flex-1 bg-white/5 hover:bg-emerald-400/10 border border-white/10 hover:border-emerald-400/30 rounded-lg py-2 transition-all text-center"
                  >
                    <div className="font-mono font-bold text-emerald-400">
                      {game.odds.black.toFixed(2)}
                    </div>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ===== OTHER LIVE MATCHES ===== */}
      {liveGames.length > 1 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-500 live-dot" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Also Live
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {liveGames
              .filter((g) => g.id !== featured?.id)
              .map((game) => (
                <div
                  key={game.id}
                  onClick={() => router.push(`/game/${game.id}`)}
                  className="glass rounded-xl p-4 cursor-pointer hover:border-red-500/30 transition-all border border-transparent"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{game.white_avatar}</span>
                      <span className="font-bold text-white text-sm">
                        {game.white_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                      <span className="text-red-400 text-xs font-bold">
                        LIVE
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">
                        {game.black_name}
                      </span>
                      <span className="text-xl">{game.black_avatar}</span>
                    </div>
                  </div>
                  <div className="flex justify-center gap-4 mt-2">
                    <span className="font-mono text-emerald-400 text-sm font-bold">
                      {game.odds.white.toFixed(2)}
                    </span>
                    <span className="text-zinc-600 text-xs">vs</span>
                    <span className="font-mono text-emerald-400 text-sm font-bold">
                      {game.odds.black.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ===== RECENT RESULTS ===== */}
      {finishedGames.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-bold text-zinc-600 uppercase tracking-wider mb-3">
            Results
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {finishedGames.map((game) => (
              <div
                key={game.id}
                onClick={() => router.push(`/game/${game.id}`)}
                className="glass rounded-lg p-3 cursor-pointer opacity-60 hover:opacity-100 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{game.white_avatar}</span>
                    <span className="text-sm text-white">
                      {game.white_name}
                    </span>
                  </div>
                  <span
                    className={`font-mono font-bold text-sm ${
                      game.result === "1-0"
                        ? "text-emerald-400"
                        : game.result === "0-1"
                          ? "text-red-400"
                          : "text-zinc-500"
                    }`}
                  >
                    {game.result}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white">
                      {game.black_name}
                    </span>
                    <span>{game.black_avatar}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ===== YOUR ACTIVE BETS ===== */}
      {userData &&
        userData.bets.filter((b) => b.status === "pending").length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-bold text-amber-400/60 uppercase tracking-wider mb-3">
              Your Active Bets
            </h2>
            <div className="glass rounded-xl overflow-hidden">
              {userData.bets
                .filter((b) => b.status === "pending")
                .map((bet) => (
                  <div
                    key={bet.id}
                    className="flex items-center justify-between px-4 py-3 border-b border-white/5 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{bet.agent_avatar}</span>
                      <span className="text-sm font-bold text-white">
                        {bet.agent_name}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono">
                        <span className="text-amber-400">{bet.amount}</span>
                        <span className="text-zinc-600 mx-1">@</span>
                        <span className="text-emerald-400">
                          {bet.odds.toFixed(2)}x
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-600">
                        Win {Math.round(bet.amount * bet.odds)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}
    </div>
  );
}

function getTimeUntil(scheduledAt: string): string {
  const now = new Date();
  const scheduled = new Date(scheduledAt + "Z");
  const diff = scheduled.getTime() - now.getTime();

  if (diff <= 0) return "Starting...";

  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
