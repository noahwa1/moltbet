"use client";

import { useState, useEffect, useCallback, use } from "react";
import ChessBoard from "@/components/ChessBoard";
import BettingPanel from "@/components/BettingPanel";
import MoveLog from "@/components/MoveLog";
import GameResult from "@/components/GameResult";

interface GameData {
  id: string;
  white_id: string;
  black_id: string;
  white_name: string;
  black_name: string;
  white_avatar: string;
  black_avatar: string;
  white_elo: number;
  black_elo: number;
  white_model: string;
  black_model: string;
  status: string;
  fen: string;
  moves: string;
  result: string | null;
}

interface Move {
  san: string;
  comment: string;
  thinkingTime: number;
  color: "w" | "b";
  moveNumber: number;
  fen: string;
}

export default function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [game, setGame] = useState<GameData | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [balance, setBalance] = useState(10000);
  const [showResult, setShowResult] = useState(false);
  const [prevStatus, setPrevStatus] = useState<string>("");

  const fetchGame = useCallback(async () => {
    const res = await fetch(`/api/games/${id}`);
    const data = await res.json();
    setGame(data);

    try {
      const parsedMoves = JSON.parse(data.moves || "[]");
      setMoves(parsedMoves);
    } catch {
      setMoves([]);
    }

    return data;
  }, [id]);

  const fetchBalance = useCallback(async () => {
    const res = await fetch("/api/user");
    const data = await res.json();
    setBalance(data.user.balance);
  }, []);

  useEffect(() => {
    fetchGame();
    fetchBalance();
    const interval = setInterval(async () => {
      const data = await fetchGame();
      if (data.status === "finished" && prevStatus === "live") {
        setShowResult(true);
        fetchBalance();
        setTimeout(() => setShowResult(false), 5000);
      }
      setPrevStatus(data.status);
    }, 1500);
    return () => clearInterval(interval);
  }, [fetchGame, fetchBalance, prevStatus]);

  if (!game) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-bounce">♟</div>
          <div className="text-zinc-500">Loading match...</div>
        </div>
      </div>
    );
  }

  const currentTurn = game.fen.split(" ")[1] === "w" ? "white" : "black";
  const odds = calculateDisplayOdds(game.white_elo, game.black_elo);

  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Result overlay */}
      {showResult && game.result && (
        <GameResult
          result={game.result}
          whiteName={game.white_name}
          blackName={game.black_name}
          whiteAvatar={game.white_avatar}
          blackAvatar={game.black_avatar}
        />
      )}

      {/* Match header */}
      <div className="text-center mb-8 animate-slideUp">
        <div className="flex items-center justify-center gap-2 mb-3">
          {game.status === "live" && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1">
              <div className="w-2 h-2 rounded-full bg-red-500 live-dot" />
              <span className="text-red-400 text-xs font-bold uppercase tracking-wider">
                Live
              </span>
            </div>
          )}
          {game.status === "finished" && (
            <div className="bg-zinc-700/50 rounded-full px-3 py-1">
              <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">
                Finished
              </span>
            </div>
          )}
          {game.status === "pending" && (
            <div className="bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1">
              <span className="text-amber-400 text-xs font-bold uppercase tracking-wider">
                Starting...
              </span>
            </div>
          )}
        </div>

        {/* Player vs Player header */}
        <div className="flex items-center justify-center gap-8">
          <div className={`flex items-center gap-3 ${currentTurn === "white" && game.status === "live" ? "animate-pulse" : ""}`}>
            <span className="text-4xl">{game.white_avatar}</span>
            <div className="text-left">
              <div className="font-bold text-white text-lg">{game.white_name}</div>
              <div className="text-xs text-zinc-500">
                ELO {game.white_elo} · {game.white_model}
              </div>
            </div>
            {currentTurn === "white" && game.status === "live" && (
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse ml-2" />
            )}
          </div>

          <div className="text-center">
            {game.result ? (
              <div className={`text-3xl font-mono font-black ${
                game.result === "1-0" ? "text-emerald-400" : game.result === "0-1" ? "text-red-400" : "text-zinc-400"
              }`}>
                {game.result}
              </div>
            ) : (
              <div className="text-3xl font-black text-zinc-600">VS</div>
            )}
          </div>

          <div className={`flex items-center gap-3 ${currentTurn === "black" && game.status === "live" ? "animate-pulse" : ""}`}>
            {currentTurn === "black" && game.status === "live" && (
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse mr-2" />
            )}
            <div className="text-right">
              <div className="font-bold text-white text-lg">{game.black_name}</div>
              <div className="text-xs text-zinc-500">
                ELO {game.black_elo} · {game.black_model}
              </div>
            </div>
            <span className="text-4xl">{game.black_avatar}</span>
          </div>
        </div>
      </div>

      {/* Main game area */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 items-start">
        {/* Left: Betting */}
        <div className="space-y-4">
          <BettingPanel
            gameId={game.id}
            white={{
              id: game.white_id,
              name: game.white_name,
              avatar: game.white_avatar,
              elo: game.white_elo,
            }}
            black={{
              id: game.black_id,
              name: game.black_name,
              avatar: game.black_avatar,
              elo: game.black_elo,
            }}
            odds={odds}
            balance={balance}
            onBetPlaced={fetchBalance}
            disabled={game.status === "finished"}
          />

          {/* Move count / game stats */}
          <div className="glass rounded-xl p-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-2xl font-bold text-white font-mono">
                  {moves.length}
                </div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  Moves
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white font-mono">
                  {moves.length > 0
                    ? (
                        moves.reduce((a, m) => a + m.thinkingTime, 0) /
                        moves.length /
                        1000
                      ).toFixed(1)
                    : "0.0"}
                  <span className="text-xs">s</span>
                </div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  Avg Think
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white font-mono">
                  {Math.ceil(moves.length / 2)}
                </div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  Round
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Chess Board */}
        <div className="flex justify-center">
          <ChessBoard fen={game.fen} size={480} />
        </div>

        {/* Right: Move log */}
        <MoveLog
          moves={moves}
          whiteName={game.white_name}
          blackName={game.black_name}
          whiteAvatar={game.white_avatar}
          blackAvatar={game.black_avatar}
        />
      </div>
    </div>
  );
}

function calculateDisplayOdds(
  whiteElo: number,
  blackElo: number
): { white: number; black: number; draw: number } {
  const expectedWhite =
    1 / (1 + Math.pow(10, (blackElo - whiteElo) / 400));
  const drawProb = 0.1;
  const whiteProb = expectedWhite * (1 - drawProb);
  const blackProb = (1 - expectedWhite) * (1 - drawProb);

  return {
    white: Math.max(1.05, parseFloat((1 / whiteProb).toFixed(2))),
    black: Math.max(1.05, parseFloat((1 / blackProb).toFixed(2))),
    draw: parseFloat((1 / drawProb).toFixed(2)),
  };
}
