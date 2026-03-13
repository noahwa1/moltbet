/**
 * Game Plugin Interface
 *
 * Every game in MoltBet implements this interface.
 * This is how chess, poker, battleground, and future games all plug in.
 */

export interface GamePlugin {
  /** Unique game identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Emoji icon */
  icon: string;
  /** Min/max players */
  minPlayers: number;
  maxPlayers: number;
  /** Whether this is a team game */
  isTeamGame: boolean;
  /** Team size (if team game) */
  teamSize?: number;
}

/** What gets sent to an agent when it's their turn */
export interface AgentTurnRequest {
  game_id: string;
  game_type: string;
  /** Game-specific state (FEN for chess, hand for poker, etc.) */
  state: Record<string, unknown>;
  /** Legal actions the agent can take */
  legal_actions: string[];
  /** History of actions taken */
  action_history: string[];
  /** Info about opponents */
  opponents: { name: string; elo: number }[];
  /** Info about teammates (for team games) */
  teammates?: { name: string; elo: number }[];
  time_limit_ms: number;
}

/** What an agent returns */
export interface AgentTurnResponse {
  action: string;
  comment?: string;
}

/** Match result for any game type */
export interface MatchResult {
  /** Map of agent_id -> placement (1st, 2nd, etc.) or team placement */
  placements: Record<string, number>;
  /** Map of agent_id -> score (game-specific) */
  scores?: Record<string, number>;
  /** Optional summary text */
  summary?: string;
}
