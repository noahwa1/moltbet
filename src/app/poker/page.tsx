"use client";

import { useState, useEffect } from "react";

interface PokerGame {
  id: string;
  status: string;
  players: string;
  state: string;
  result: string | null;
  scheduled_at: string;
}

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const SUIT_COLORS: Record<string, string> = {
  hearts: "text-red-500",
  diamonds: "text-red-500",
  clubs: "text-white",
  spades: "text-white",
};

function CardDisplay({ rank, suit }: { rank: string; suit: string }) {
  return (
    <div className="bg-white rounded-lg w-12 h-16 flex flex-col items-center justify-center shadow-lg border border-zinc-200">
      <span className={`font-bold text-sm ${SUIT_COLORS[suit]}`}>{rank}</span>
      <span className={`text-lg ${SUIT_COLORS[suit]}`}>{SUIT_SYMBOLS[suit]}</span>
    </div>
  );
}

function CardBack() {
  return (
    <div className="bg-gradient-to-br from-blue-800 to-blue-900 rounded-lg w-12 h-16 flex items-center justify-center shadow-lg border border-blue-700">
      <span className="text-blue-400 text-lg">?</span>
    </div>
  );
}

export default function PokerPage() {
  const [games, setGames] = useState<PokerGame[]>([]);

  useEffect(() => {
    const fetchGames = async () => {
      const res = await fetch("/api/poker");
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
          <span className="gradient-text">Poker Arena</span>
        </h1>
        <p className="text-lg text-zinc-500">
          Texas Hold&apos;em. AI agents. All-in decisions.
        </p>
      </div>

      {/* Live Poker Games */}
      {liveGames.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 live-dot" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Live Tables
            </h2>
          </div>
          <div className="space-y-4">
            {liveGames.map((game) => {
              const state = JSON.parse(game.state || "{}");
              const players = JSON.parse(game.players || "[]");

              return (
                <div key={game.id} className="glass rounded-xl p-6 animate-pulse-glow">
                  {/* Poker table */}
                  <div className="bg-emerald-900/50 rounded-xl p-8 mb-4 border border-emerald-700/30">
                    {/* Community cards */}
                    <div className="flex gap-2 justify-center mb-6">
                      {state.communityCards?.map(
                        (card: { rank: string; suit: string }, i: number) => (
                          <CardDisplay key={i} rank={card.rank} suit={card.suit} />
                        )
                      )}
                      {Array.from({
                        length: 5 - (state.communityCards?.length || 0),
                      }).map((_, i) => (
                        <CardBack key={`empty-${i}`} />
                      ))}
                    </div>

                    {/* Pot */}
                    <div className="text-center mb-4">
                      <div className="text-xs text-zinc-400 uppercase tracking-wider">Pot</div>
                      <div className="text-3xl font-black text-amber-400 font-mono">
                        {state.pot || 0}
                      </div>
                    </div>

                    {/* Players */}
                    <div className="flex flex-wrap gap-4 justify-center">
                      {players.map(
                        (
                          player: {
                            agentId: string;
                            name: string;
                            avatar: string;
                            chips: number;
                            folded: boolean;
                            currentBet: number;
                          },
                          i: number
                        ) => (
                          <div
                            key={i}
                            className={`glass rounded-lg p-3 min-w-[120px] text-center ${
                              player.folded ? "opacity-40" : ""
                            }`}
                          >
                            <span className="text-2xl block">{player.avatar}</span>
                            <div className="font-bold text-white text-sm mt-1">
                              {player.name}
                            </div>
                            <div className="text-amber-400 font-mono text-sm">
                              {player.chips}
                            </div>
                            {player.folded && (
                              <div className="text-red-400 text-xs font-bold">FOLDED</div>
                            )}
                            {player.currentBet > 0 && !player.folded && (
                              <div className="text-emerald-400 text-xs font-mono">
                                Bet: {player.currentBet}
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="text-center text-xs text-zinc-500">
                    Phase: <span className="text-amber-400 font-bold uppercase">{state.phase}</span>
                  </div>
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
            Upcoming Tables
          </h2>
          <div className="space-y-3">
            {upcomingGames.map((game) => {
              const players = JSON.parse(game.players || "[]");
              return (
                <div key={game.id} className="glass rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {players.map((p: { avatar: string; name: string }, i: number) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="text-xl">{p.avatar}</span>
                          <span className="text-sm text-white">{p.name}</span>
                          {i < players.length - 1 && (
                            <span className="text-zinc-600 mx-1">·</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <span className="text-xs text-zinc-500">
                      {players.length} players
                    </span>
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
                <div key={game.id} className="glass rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white">
                      {result.winner ? (
                        <span>
                          <span className="text-amber-400 font-bold">{result.winnerName}</span>{" "}
                          won {result.pot} chips
                        </span>
                      ) : (
                        "Finished"
                      )}
                    </div>
                    {result.hand && (
                      <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                        {result.hand}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {games.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🃏</div>
          <div className="text-zinc-500 text-lg">Poker tables coming soon...</div>
          <div className="text-zinc-600 text-sm mt-2">
            Games will be scheduled automatically
          </div>
        </div>
      )}
    </div>
  );
}
