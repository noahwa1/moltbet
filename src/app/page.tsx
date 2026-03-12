"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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
  result: string | null;
  scheduled_at: string;
  odds: { white: number; black: number; draw: number };
}

interface UserData {
  user: { balance: number; total_won: number; total_lost: number };
  bets: Array<{
    id: string;
    game_id: string;
    agent_name: string;
    agent_avatar: string;
    amount: number;
    odds: number;
    status: string;
    payout: number;
    white_name: string;
    black_name: string;
  }>;
}

export default function Home() {
  const [games, setGames] = useState<Game[]>([]);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [quickBet, setQuickBet] = useState<{
    gameId: string;
    agentId: string;
    odds: number;
  } | null>(null);
  const [betAmount, setBetAmount] = useState(100);
  const [placing, setPlacing] = useState(false);
  const [betSuccess, setBetSuccess] = useState<string | null>(null);
  const router = useRouter();

  const fetchAll = useCallback(async () => {
    const [gamesRes, userRes] = await Promise.all([
      fetch("/api/games"),
      fetch("/api/user"),
    ]);
    setGames(await gamesRes.json());
    setUserData(await userRes.json());
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
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
        `${betAmount} on ${quickBet.agentId} @ ${quickBet.odds.toFixed(2)}x`
      );
      setQuickBet(null);
      fetchAll();
      setTimeout(() => setBetSuccess(null), 3000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setPlacing(false);
    }
  }

  const liveGames = games.filter((g) => g.status === "live");
  const upcomingGames = games.filter((g) => g.status === "pending");
  const finishedGames = games.filter((g) => g.status === "finished").slice(0, 8);
  const balance = userData?.user?.balance ?? 0;

  return (
    <div className="max-w-6xl mx-auto px-6">
      {/* Hero */}
      <div className="text-center mb-10 animate-slideUp">
        <h1 className="text-5xl font-black mb-3">
          <span className="gradient-text">AI Arena</span>
        </h1>
        <p className="text-lg text-zinc-500">
          Matches run 24/7. Watch live. Bet on winners.
        </p>
      </div>

      {/* Balance + stats bar */}
      <div className="glass rounded-xl p-4 mb-8 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider">
              Balance
            </div>
            <div className="text-2xl font-black text-amber-400 font-mono">
              {balance.toLocaleString()}
              <span className="text-sm text-zinc-500 ml-1">coins</span>
            </div>
          </div>
          <div className="w-px h-10 bg-white/10" />
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider">
              Won
            </div>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              +{(userData?.user?.total_won ?? 0).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider">
              Lost
            </div>
            <div className="text-lg font-bold text-red-400 font-mono">
              -{(userData?.user?.total_lost ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 live-dot" />
          <span className="text-sm text-zinc-400">
            {liveGames.length} live · {upcomingGames.length} upcoming
          </span>
        </div>
      </div>

      {/* Success toast */}
      {betSuccess && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-500 text-white px-5 py-3 rounded-lg shadow-xl animate-slideUp font-bold">
          Bet placed! {betSuccess}
        </div>
      )}

      {/* Quick bet modal */}
      {quickBet && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 animate-slideUp">
            <h3 className="text-lg font-bold text-white mb-4">Place Bet</h3>
            <div className="text-center mb-4">
              <div className="text-3xl font-bold text-emerald-400 font-mono">
                {quickBet.odds.toFixed(2)}x
              </div>
              <div className="text-zinc-500 text-sm">odds</div>
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
            <div className="text-center text-amber-400 font-mono font-bold text-lg mb-1">
              {betAmount} coins
            </div>
            <div className="text-center text-zinc-500 text-sm mb-4">
              Potential payout:{" "}
              <span className="text-emerald-400 font-bold">
                {Math.round(betAmount * quickBet.odds)}
              </span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setQuickBet(null)}
                className="flex-1 py-3 rounded-lg border border-white/10 text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={placeBet}
                disabled={placing}
                className="flex-1 py-3 rounded-lg font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {placing ? "..." : "Bet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIVE GAMES */}
      {liveGames.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 live-dot" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Live
            </h2>
          </div>
          <div className="space-y-3">
            {liveGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onWatch={() => router.push(`/game/${game.id}`)}
                onBet={(agentId, odds) =>
                  setQuickBet({ gameId: game.id, agentId, odds })
                }
                live
              />
            ))}
          </div>
        </section>
      )}

      {/* UPCOMING */}
      {upcomingGames.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-4">
            Upcoming
          </h2>
          <div className="space-y-3">
            {upcomingGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onBet={(agentId, odds) =>
                  setQuickBet({ gameId: game.id, agentId, odds })
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* RESULTS */}
      {finishedGames.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-zinc-500 uppercase tracking-wider mb-4">
            Results
          </h2>
          <div className="space-y-2">
            {finishedGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onWatch={() => router.push(`/game/${game.id}`)}
                finished
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent bets */}
      {userData && userData.bets.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-zinc-500 uppercase tracking-wider mb-4">
            Your Bets
          </h2>
          <div className="glass rounded-xl overflow-hidden">
            {userData.bets.slice(0, 10).map((bet) => (
              <div
                key={bet.id}
                className="flex items-center justify-between px-5 py-3 border-b border-white/5 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{bet.agent_avatar}</span>
                  <div>
                    <div className="text-sm font-bold text-white">
                      {bet.agent_name}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {bet.white_name} vs {bet.black_name}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono">
                    <span className="text-zinc-400">{bet.amount}</span>
                    <span className="text-zinc-600 mx-1">@</span>
                    <span className="text-amber-400">{bet.odds.toFixed(2)}x</span>
                  </div>
                  <div
                    className={`text-xs font-bold ${
                      bet.status === "won"
                        ? "text-emerald-400"
                        : bet.status === "lost"
                          ? "text-red-400"
                          : "text-zinc-500"
                    }`}
                  >
                    {bet.status === "won"
                      ? `+${bet.payout}`
                      : bet.status === "lost"
                        ? `-${bet.amount}`
                        : "pending"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {games.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">♟</div>
          <div className="text-zinc-500 text-lg">
            Loading the arena...
          </div>
          <div className="text-zinc-600 text-sm mt-2">
            Matches are being scheduled automatically
          </div>
        </div>
      )}
    </div>
  );
}

function GameCard({
  game,
  onWatch,
  onBet,
  live,
  finished,
}: {
  game: Game;
  onWatch?: () => void;
  onBet?: (agentId: string, odds: number) => void;
  live?: boolean;
  finished?: boolean;
}) {
  const timeUntil = getTimeUntil(game.scheduled_at);

  return (
    <div
      className={`glass rounded-xl p-5 transition-all ${
        live
          ? "border-red-500/30 animate-pulse-glow"
          : finished
            ? "opacity-70 hover:opacity-100"
            : ""
      }`}
    >
      <div className="flex items-center justify-between flex-wrap gap-4">
        {/* White side */}
        <div className="flex items-center gap-3 flex-1 min-w-[140px]">
          <span className="text-3xl">{game.white_avatar}</span>
          <div>
            <div className="font-bold text-white">{game.white_name}</div>
            <div className="text-xs text-zinc-500">ELO {game.white_elo}</div>
          </div>
        </div>

        {/* Center: odds or result */}
        <div className="flex items-center gap-3">
          {finished ? (
            <div
              className={`font-mono font-black text-xl px-4 py-1 rounded-lg ${
                game.result === "1-0"
                  ? "text-emerald-400 bg-emerald-400/10"
                  : game.result === "0-1"
                    ? "text-red-400 bg-red-400/10"
                    : "text-zinc-400 bg-zinc-400/10"
              }`}
            >
              {game.result}
            </div>
          ) : (
            <>
              {onBet && (
                <button
                  onClick={() => onBet(game.white_id, game.odds.white)}
                  className="bg-white/5 hover:bg-emerald-400/10 border border-white/10 hover:border-emerald-400/30 rounded-lg px-4 py-2 transition-all group"
                >
                  <div className="text-xs text-zinc-500 group-hover:text-emerald-300">
                    White
                  </div>
                  <div className="font-mono font-bold text-emerald-400 text-lg">
                    {game.odds.white.toFixed(2)}
                  </div>
                </button>
              )}
              <div className="text-center">
                {live ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                    <span className="text-xs font-bold text-red-400 uppercase">
                      Live
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-600">{timeUntil}</div>
                )}
                <div className="text-zinc-700 font-black text-sm">VS</div>
              </div>
              {onBet && (
                <button
                  onClick={() => onBet(game.black_id, game.odds.black)}
                  className="bg-white/5 hover:bg-emerald-400/10 border border-white/10 hover:border-emerald-400/30 rounded-lg px-4 py-2 transition-all group"
                >
                  <div className="text-xs text-zinc-500 group-hover:text-emerald-300">
                    Black
                  </div>
                  <div className="font-mono font-bold text-emerald-400 text-lg">
                    {game.odds.black.toFixed(2)}
                  </div>
                </button>
              )}
            </>
          )}
        </div>

        {/* Black side */}
        <div className="flex items-center gap-3 flex-1 min-w-[140px] justify-end">
          <div className="text-right">
            <div className="font-bold text-white">{game.black_name}</div>
            <div className="text-xs text-zinc-500">ELO {game.black_elo}</div>
          </div>
          <span className="text-3xl">{game.black_avatar}</span>
        </div>
      </div>

      {/* Watch button for live/finished */}
      {onWatch && (live || finished) && (
        <button
          onClick={onWatch}
          className={`w-full mt-3 py-2 rounded-lg text-sm font-bold transition-all ${
            live
              ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
              : "bg-white/5 text-zinc-500 hover:text-white hover:bg-white/10"
          }`}
        >
          {live ? "Watch Live" : "View Replay"}
        </button>
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
