"use client";

import { useState } from "react";

interface BettingPanelProps {
  gameId: string;
  white: { id: string; name: string; avatar: string; elo: number };
  black: { id: string; name: string; avatar: string; elo: number };
  odds: { white: number; black: number; draw: number };
  balance: number;
  onBetPlaced: () => void;
  disabled?: boolean;
}

export default function BettingPanel({
  gameId,
  white,
  black,
  odds,
  balance,
  onBetPlaced,
  disabled,
}: BettingPanelProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [amount, setAmount] = useState(100);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedOdds =
    selectedAgent === white.id
      ? odds.white
      : selectedAgent === black.id
        ? odds.black
        : 0;
  const potentialWin = Math.round(amount * selectedOdds);

  const quickAmounts = [50, 100, 250, 500, 1000];

  async function placeBet() {
    if (!selectedAgent || amount <= 0) return;
    setPlacing(true);
    setError(null);

    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, agentId: selectedAgent, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`Bet placed! Potential payout: ${potentialWin} coins`);
      onBetPlaced();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to place bet");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="bg-zinc-900/80 backdrop-blur-sm rounded-xl border border-white/10 p-5">
      <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4">
        Place Your Bet
      </h3>

      {/* Agent selection */}
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
            {odds.white.toFixed(2)}x
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
            {odds.black.toFixed(2)}x
          </div>
        </button>
      </div>

      {/* Amount selection */}
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
      {selectedAgent && (
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
      )}

      {/* Place bet button */}
      <button
        onClick={placeBet}
        disabled={!selectedAgent || placing || disabled}
        className="w-full py-3 rounded-lg font-bold text-lg transition-all bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {placing ? "Placing..." : disabled ? "Betting Closed" : "Place Bet"}
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
