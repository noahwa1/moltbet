"use client";

import { useState, useEffect, useCallback, use } from "react";
import ChessBoard from "@/components/ChessBoard";
import BettingPanel from "@/components/BettingPanel";
import MoveLog from "@/components/MoveLog";
import GameResult from "@/components/GameResult";
import OddsSparkline from "@/components/OddsSparkline";

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
  liveOdds: {
    white: number;
    black: number;
    draw: number;
    whiteWinProb: number;
    blackWinProb: number;
    drawProb: number;
    evaluation: number;
    momentum: "white" | "black" | "neutral";
  } | null;
  oddsHistory: Array<{
    moveNumber: number;
    white: number;
    black: number;
    evaluation: number;
    timestamp: number;
  }>;
  lines?: {
    moneyline: { white: number; black: number; draw: number };
    spread: {
      line: number;
      favorite: "white" | "black";
      favoriteOdds: number;
      underdogOdds: number;
      description: string;
    };
    overUnder: {
      line: number;
      overOdds: number;
      underOdds: number;
    };
  } | null;
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
  const odds = game.liveOdds
    ? { white: game.liveOdds.white, black: game.liveOdds.black, draw: game.liveOdds.draw }
    : calculateDisplayOdds(game.white_elo, game.black_elo);

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
        <div className="flex items-center justify-center gap-6 flex-wrap">
          <div className={`flex items-center gap-2 ${currentTurn === "white" && game.status === "live" ? "animate-pulse" : ""}`}>
            <span className="text-3xl">{game.white_avatar}</span>
            <div className="text-left">
              <div className="font-bold text-white">{game.white_name}</div>
              <div className="text-xs text-zinc-500">
                ELO {game.white_elo}
              </div>
            </div>
            {currentTurn === "white" && game.status === "live" && (
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </div>

          <div className="text-center">
            {game.result ? (
              <div className={`text-2xl font-mono font-black ${
                game.result === "1-0" ? "text-emerald-400" : game.result === "0-1" ? "text-red-400" : "text-zinc-400"
              }`}>
                {game.result}
              </div>
            ) : (
              <div className="text-2xl font-black text-zinc-600">VS</div>
            )}
          </div>

          <div className={`flex items-center gap-2 ${currentTurn === "black" && game.status === "live" ? "animate-pulse" : ""}`}>
            {currentTurn === "black" && game.status === "live" && (
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
            <div className="text-right">
              <div className="font-bold text-white">{game.black_name}</div>
              <div className="text-xs text-zinc-500">
                ELO {game.black_elo}
              </div>
            </div>
            <span className="text-3xl">{game.black_avatar}</span>
          </div>
        </div>
      </div>

      {/* Main game area */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-6 items-start">
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
            lines={game.lines}
            balance={balance}
            onBetPlaced={fetchBalance}
            disabled={game.status === "finished"}
            isLive={game.status === "live"}
          />

          {/* Momentum indicator */}
          {game.liveOdds && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Momentum</span>
                <span className={`text-xs font-bold ${
                  game.liveOdds.momentum === "white" ? "text-emerald-400" :
                  game.liveOdds.momentum === "black" ? "text-red-400" : "text-zinc-400"
                }`}>
                  {game.liveOdds.momentum === "white" ? "White Surging" :
                   game.liveOdds.momentum === "black" ? "Black Surging" : "Even"}
                </span>
              </div>
              {/* Win probability bar */}
              <div className="flex h-2 rounded-full overflow-hidden bg-zinc-800">
                <div
                  className="bg-emerald-500 transition-all duration-500"
                  style={{ width: `${game.liveOdds.whiteWinProb * 100}%` }}
                />
                <div
                  className="bg-zinc-600 transition-all duration-500"
                  style={{ width: `${game.liveOdds.drawProb * 100}%` }}
                />
                <div
                  className="bg-red-500 transition-all duration-500"
                  style={{ width: `${game.liveOdds.blackWinProb * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] mt-1">
                <span className="text-emerald-400 font-mono">{(game.liveOdds.whiteWinProb * 100).toFixed(0)}%</span>
                <span className="text-zinc-500 font-mono">{(game.liveOdds.drawProb * 100).toFixed(0)}%</span>
                <span className="text-red-400 font-mono">{(game.liveOdds.blackWinProb * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}

          {/* Odds sparkline */}
          <OddsSparkline history={game.oddsHistory ?? []} width={260} height={100} />

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
        <div className="flex justify-center w-full max-w-[440px] mx-auto">
          <ChessBoard fen={game.fen} size={440} />
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
