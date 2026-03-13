export interface AgentStats {
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
}

export interface PrestigeTier {
  name: string;
  color: string;
  bgColor: string;
}

export function getPrestigeTier(agent: AgentStats): PrestigeTier {
  const { games_played, wins } = agent;
  const winRate = games_played > 0 ? wins / games_played : 0;

  if (games_played >= 100 && winRate > 0.6) {
    return { name: "GOAT", color: "text-amber-300", bgColor: "bg-amber-400/20 border-amber-400/40" };
  }
  if (games_played >= 50 && winRate > 0.55) {
    return { name: "Legendary", color: "text-purple-400", bgColor: "bg-purple-400/20 border-purple-400/40" };
  }
  if (games_played >= 25 && winRate > 0.5) {
    return { name: "Elite", color: "text-emerald-400", bgColor: "bg-emerald-400/20 border-emerald-400/40" };
  }
  if (games_played >= 10) {
    return { name: "Contender", color: "text-blue-400", bgColor: "bg-blue-400/20 border-blue-400/40" };
  }
  return { name: "Rookie", color: "text-zinc-400", bgColor: "bg-zinc-400/20 border-zinc-400/40" };
}

export interface PlaystyleTag {
  label: string;
  color: string;
  bgColor: string;
}

export function getPlaystyleTags(agent: AgentStats): PlaystyleTag[] {
  const tags: PlaystyleTag[] = [];
  const { wins, losses, draws, games_played } = agent;

  if (games_played === 0) return tags;

  if (wins > losses * 2) {
    tags.push({ label: "Dominant", color: "text-amber-400", bgColor: "bg-amber-400/10" });
  }
  if (draws > wins && games_played >= 5) {
    tags.push({ label: "Defensive", color: "text-blue-400", bgColor: "bg-blue-400/10" });
  }
  if (games_played > 50) {
    tags.push({ label: "Veteran", color: "text-zinc-300", bgColor: "bg-zinc-500/10" });
  }
  if (losses === 0 && wins > 0) {
    tags.push({ label: "Undefeated", color: "text-emerald-400", bgColor: "bg-emerald-400/10" });
  }
  if (wins === 0 && losses > 0) {
    tags.push({ label: "Underdog", color: "text-red-400", bgColor: "bg-red-400/10" });
  }
  const winRate = wins / games_played;
  if (winRate >= 0.7 && games_played >= 10) {
    tags.push({ label: "Crusher", color: "text-orange-400", bgColor: "bg-orange-400/10" });
  }
  if (draws / games_played > 0.3 && games_played >= 5) {
    tags.push({ label: "Grinder", color: "text-teal-400", bgColor: "bg-teal-400/10" });
  }

  return tags;
}

// Volatility rating constants for game types
export interface VolatilityRating {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

export const VOLATILITY_RATINGS: Record<string, VolatilityRating> = {
  chess: {
    label: "Low Variance",
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
    borderColor: "border-emerald-400/30",
  },
  poker: {
    label: "High Variance",
    color: "text-red-400",
    bgColor: "bg-red-400/10",
    borderColor: "border-red-400/30",
  },
  battleground: {
    label: "Medium Variance",
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
    borderColor: "border-amber-400/30",
  },
};
