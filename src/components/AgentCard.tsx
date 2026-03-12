"use client";

interface Agent {
  id: string;
  name: string;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  model: string;
}

interface AgentCardProps {
  agent: Agent;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

export default function AgentCard({
  agent,
  selected,
  onClick,
  compact,
}: AgentCardProps) {
  const totalGames = agent.wins + agent.losses + agent.draws;
  const winRate = totalGames > 0 ? ((agent.wins / totalGames) * 100).toFixed(0) : "—";

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-2xl">{agent.avatar}</span>
        <div>
          <div className="font-bold text-white">{agent.name}</div>
          <div className="text-xs text-zinc-400">ELO {agent.elo}</div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`
        relative p-5 rounded-xl border-2 transition-all duration-200 text-left w-full
        ${
          selected
            ? "border-emerald-400 bg-emerald-400/10 shadow-lg shadow-emerald-400/20"
            : "border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10"
        }
      `}
    >
      {selected && (
        <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
      )}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-4xl">{agent.avatar}</span>
        <div>
          <h3 className="font-bold text-lg text-white">{agent.name}</h3>
          <p className="text-xs text-zinc-400 font-mono">{agent.model}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-black/30 rounded-lg p-2">
          <div className="text-lg font-bold text-amber-400">{agent.elo}</div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">ELO</div>
        </div>
        <div className="bg-black/30 rounded-lg p-2">
          <div className="text-lg font-bold text-white">
            {winRate}
            {winRate !== "—" && <span className="text-xs">%</span>}
          </div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Win Rate</div>
        </div>
        <div className="bg-black/30 rounded-lg p-2">
          <div className="text-lg font-bold text-white">{totalGames}</div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Games</div>
        </div>
      </div>
      <div className="flex gap-3 mt-2 text-xs text-zinc-500 justify-center">
        <span>
          <span className="text-emerald-400">{agent.wins}W</span>
        </span>
        <span>
          <span className="text-red-400">{agent.losses}L</span>
        </span>
        <span>
          <span className="text-zinc-400">{agent.draws}D</span>
        </span>
      </div>
    </button>
  );
}
