"use client";

import { useState } from "react";

interface BettingLines {
  moneyline: {
    white: number;
    black: number;
    draw: number;
  };
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
}

interface BettingPanelProps {
  gameId: string;
  white: { id: string; name: string; avatar: string; elo: number };
  black: { id: string; name: string; avatar: string; elo: number };
  odds: { white: number; black: number; draw: number };
  lines?: BettingLines | null;
  balance: number;
  onBetPlaced: () => void;
  disabled?: boolean;
  isLive?: boolean;
}

type BetType = "moneyline" | "spread" | "over_under";

export default function BettingPanel({
  gameId,
  white,
  black,
  odds,
  lines,
  balance,
  onBetPlaced,
  disabled,
  isLive,
}: BettingPanelProps) {
  const [tab, setTab] = useState<BetType>("moneyline");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [spreadSide, setSpreadSide] = useState<"favorite" | "underdog" | null>(null);
  const [ouSide, setOuSide] = useState<"over" | "under" | null>(null);
  const [amount, setAmount] = useState(100);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const currentLines = lines ?? {
    moneyline: odds,
    spread: {
      line: -1.5,
      favorite: (white.elo >= black.elo ? "white" : "black") as "white" | "black",
      favoriteOdds: odds.white < odds.black ? odds.white : odds.black,
      underdogOdds: odds.white < odds.black ? odds.black : odds.white,
      description: "",
    },
    overUnder: {
      line: 80.5,
      overOdds: 1.91,
      underOdds: 1.91,
    },
  };

  // Get selected odds based on tab
  let selectedOdds = 0;
  if (tab === "moneyline" && selectedAgent) {
    selectedOdds = selectedAgent === white.id ? currentLines.moneyline.white : currentLines.moneyline.black;
  } else if (tab === "spread" && spreadSide) {
    selectedOdds = spreadSide === "favorite" ? currentLines.spread.favoriteOdds : currentLines.spread.underdogOdds;
  } else if (tab === "over_under" && ouSide) {
    selectedOdds = ouSide === "over" ? currentLines.overUnder.overOdds : currentLines.overUnder.underOdds;
  }

  const potentialWin = Math.round(amount * selectedOdds);
  const hasSelection =
    (tab === "moneyline" && selectedAgent) ||
    (tab === "spread" && spreadSide) ||
    (tab === "over_under" && ouSide);

  const quickAmounts = [50, 100, 250, 500, 1000];

  async function placeBet() {
    if (!hasSelection || amount <= 0) return;
    setPlacing(true);
    setError(null);

    const body: Record<string, unknown> = {
      gameId,
      amount,
      betType: tab,
    };

    if (tab === "moneyline") {
      body.agentId = selectedAgent;
    } else if (tab === "spread") {
      body.side = spreadSide;
    } else if (tab === "over_under") {
      body.side = ouSide;
    }

    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const label =
        tab === "moneyline"
          ? `${selectedAgent === white.id ? white.name : black.name}`
          : tab === "spread"
            ? `${spreadSide === "favorite" ? "Favorite" : "Underdog"} ${currentLines.spread.line}`
            : `${ouSide} ${currentLines.overUnder.line} moves`;

      setSuccess(`${amount} on ${label} @ ${selectedOdds.toFixed(2)}x → Win ${potentialWin}`);
      setSelectedAgent(null);
      setSpreadSide(null);
      setOuSide(null);
      onBetPlaced();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to place bet");
    } finally {
      setPlacing(false);
    }
  }

  const favIsWhite = currentLines.spread.favorite === "white";
  const favAgent = favIsWhite ? white : black;
  const dogAgent = favIsWhite ? black : white;

  return (
    <div className="bg-zinc-900/80 backdrop-blur-sm rounded-xl border border-white/10 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">
          Place Your Bet
        </h3>
        {isLive && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
            <span className="text-red-400 text-[10px] font-bold uppercase">Live</span>
          </div>
        )}
      </div>

      {/* Bet type tabs */}
      <div className="flex gap-1 mb-4 bg-black/40 rounded-lg p-1">
        {[
          { key: "moneyline" as BetType, label: "Moneyline" },
          { key: "spread" as BetType, label: "Spread" },
          { key: "over_under" as BetType, label: "O/U" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setSelectedAgent(null);
              setSpreadSide(null);
              setOuSide(null);
            }}
            className={`flex-1 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
              tab === key
                ? "bg-amber-400 text-black"
                : "text-zinc-500 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* === MONEYLINE === */}
      {tab === "moneyline" && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => setSelectedAgent(white.id)}
            disabled={disabled}
            className={`p-3 rounded-lg border-2 transition-all ${
              selectedAgent === white.id
                ? "border-emerald-400 bg-emerald-400/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className="text-2xl block mb-1">{white.avatar}</span>
            <div className="font-bold text-white text-sm">{white.name}</div>
            <div className="text-emerald-400 font-mono text-lg font-bold">
              {currentLines.moneyline.white.toFixed(2)}x
            </div>
          </button>
          <button
            onClick={() => setSelectedAgent(black.id)}
            disabled={disabled}
            className={`p-3 rounded-lg border-2 transition-all ${
              selectedAgent === black.id
                ? "border-emerald-400 bg-emerald-400/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className="text-2xl block mb-1">{black.avatar}</span>
            <div className="font-bold text-white text-sm">{black.name}</div>
            <div className="text-emerald-400 font-mono text-lg font-bold">
              {currentLines.moneyline.black.toFixed(2)}x
            </div>
          </button>
        </div>
      )}

      {/* === SPREAD === */}
      {tab === "spread" && (
        <div className="mb-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 text-center">
            {favAgent.name} must win outright to cover
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSpreadSide("favorite")}
              disabled={disabled}
              className={`p-3 rounded-lg border-2 transition-all ${
                spreadSide === "favorite"
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span className="text-xl block mb-1">{favAgent.avatar}</span>
              <div className="font-bold text-white text-sm">{favAgent.name}</div>
              <div className="text-amber-400 font-mono text-xs font-bold mb-1">
                {currentLines.spread.line}
              </div>
              <div className="text-emerald-400 font-mono text-lg font-bold">
                {currentLines.spread.favoriteOdds.toFixed(2)}x
              </div>
              <div className="text-[10px] text-zinc-600 mt-1">Must win</div>
            </button>
            <button
              onClick={() => setSpreadSide("underdog")}
              disabled={disabled}
              className={`p-3 rounded-lg border-2 transition-all ${
                spreadSide === "underdog"
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span className="text-xl block mb-1">{dogAgent.avatar}</span>
              <div className="font-bold text-white text-sm">{dogAgent.name}</div>
              <div className="text-teal-400 font-mono text-xs font-bold mb-1">
                +1.5
              </div>
              <div className="text-emerald-400 font-mono text-lg font-bold">
                {currentLines.spread.underdogOdds.toFixed(2)}x
              </div>
              <div className="text-[10px] text-zinc-600 mt-1">Win or draw</div>
            </button>
          </div>
        </div>
      )}

      {/* === OVER/UNDER === */}
      {tab === "over_under" && (
        <div className="mb-4">
          <div className="text-center mb-3">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              Total Moves
            </div>
            <div className="text-3xl font-black text-white font-mono">
              {currentLines.overUnder.line}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setOuSide("over")}
              disabled={disabled}
              className={`p-4 rounded-lg border-2 transition-all ${
                ouSide === "over"
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Over</div>
              <div className="text-emerald-400 font-mono text-2xl font-bold">
                {currentLines.overUnder.overOdds.toFixed(2)}x
              </div>
              <div className="text-[10px] text-zinc-600 mt-1">
                {currentLines.overUnder.line}+ moves
              </div>
            </button>
            <button
              onClick={() => setOuSide("under")}
              disabled={disabled}
              className={`p-4 rounded-lg border-2 transition-all ${
                ouSide === "under"
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Under</div>
              <div className="text-emerald-400 font-mono text-2xl font-bold">
                {currentLines.overUnder.underOdds.toFixed(2)}x
              </div>
              <div className="text-[10px] text-zinc-600 mt-1">
                Under {currentLines.overUnder.line} moves
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Amount selection */}
      {hasSelection && (
        <>
          <div className="mb-4">
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-2 block">
              Wager Amount
            </label>
            <div className="flex gap-2 mb-2 flex-wrap">
              {quickAmounts.map((q) => (
                <button
                  key={q}
                  onClick={() => setAmount(q)}
                  disabled={disabled}
                  className={`px-3 py-1.5 rounded-md text-sm font-mono transition-all ${
                    amount === q
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
              value={amount}
              onChange={(e) => setAmount(parseInt(e.target.value))}
              disabled={disabled}
              className="w-full accent-amber-400"
            />
            <div className="flex justify-between text-xs text-zinc-500 mt-1">
              <span>10</span>
              <span className="text-amber-400 font-bold text-sm">{amount} coins</span>
              <span>{Math.min(balance, 5000)}</span>
            </div>
          </div>

          {/* Potential payout */}
          <div className="bg-black/40 rounded-lg p-3 mb-4 text-center">
            <div className="text-xs text-zinc-500 uppercase tracking-wider">
              Potential Payout
            </div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">
              {potentialWin} <span className="text-sm">coins</span>
            </div>
            <div className="text-xs text-zinc-500">
              at {selectedOdds.toFixed(2)}x odds
            </div>
          </div>
        </>
      )}

      {/* Place bet button */}
      <button
        onClick={placeBet}
        disabled={!hasSelection || placing || disabled}
        className="w-full py-3 rounded-lg font-bold text-lg transition-all bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {placing
          ? "Placing..."
          : disabled
            ? "Betting Closed"
            : !hasSelection
              ? "Select an option"
              : "Place Bet"}
      </button>

      {error && (
        <div className="mt-3 text-red-400 text-sm text-center bg-red-400/10 rounded-lg p-2">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-3 text-emerald-400 text-sm text-center bg-emerald-400/10 rounded-lg p-2">
          {success}
        </div>
      )}

      {/* Balance */}
      <div className="mt-3 text-center text-xs text-zinc-500">
        Balance: <span className="text-amber-400 font-mono font-bold">{balance}</span> coins
      </div>
    </div>
  );
}
