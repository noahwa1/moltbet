import { Chess } from "chess.js";
import { getDb } from "./db";
import { getAgentMove, type MoveResult, type AgentConfig } from "./chess-engine";
import { v4 as uuid } from "uuid";

export interface GymMatch {
  id: string;
  agentId: string;
  sparringId: string;
  status: "live" | "finished";
  fen: string;
  moves: GymMove[];
  result: string | null;
  startedAt: number;
}

export interface GymMove {
  san: string;
  comment: string;
  thinkingTime: number;
  fen: string;
  moveNumber: number;
  color: "w" | "b";
}

// In-memory store for active gym matches
const gymMatches = new Map<string, GymMatch>();

export function getGymMatch(id: string): GymMatch | undefined {
  return gymMatches.get(id);
}

export function listGymMatches(): GymMatch[] {
  return Array.from(gymMatches.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
}

function toAgentConfig(agent: {
  id: string;
  name: string;
  type: string;
  model: string | null;
  personality: string | null;
  endpoint: string | null;
  api_key: string | null;
}): AgentConfig {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type === "external" ? "external" : "builtin",
    model: agent.model ?? undefined,
    personality: agent.personality ?? undefined,
    endpoint: agent.endpoint ?? undefined,
    api_key: agent.api_key ?? undefined,
  };
}

/**
 * Run a practice match in the gym.
 * No ELO changes, no earnings, no bets settled. Pure sparring.
 */
export async function runGymMatch(agentId: string, sparringId: string): Promise<GymMatch> {
  const db = getDb();

  const agentRow = db.prepare(
    "SELECT id, name, type, model, personality, endpoint, api_key, avatar, elo FROM agents WHERE id = ?"
  ).get(agentId) as {
    id: string; name: string; type: string; model: string | null;
    personality: string | null; endpoint: string | null; api_key: string | null;
    avatar: string; elo: number;
  } | undefined;

  const sparringRow = db.prepare(
    "SELECT id, name, type, model, personality, endpoint, api_key, avatar, elo FROM agents WHERE id = ?"
  ).get(sparringId) as typeof agentRow;

  if (!agentRow || !sparringRow) throw new Error("Agent not found");

  const matchId = uuid();
  const chess = new Chess();
  const moves: GymMove[] = [];
  const moveHistory: string[] = [];

  // Randomly assign colors
  const agentIsWhite = Math.random() > 0.5;
  const white = agentIsWhite ? agentRow : sparringRow;
  const black = agentIsWhite ? sparringRow : agentRow;

  const match: GymMatch = {
    id: matchId,
    agentId,
    sparringId,
    status: "live",
    fen: chess.fen(),
    moves,
    result: null,
    startedAt: Date.now(),
  };

  gymMatches.set(matchId, match);

  let moveNumber = 1;

  while (!chess.isGameOver() && moveNumber <= 150) {
    const currentAgent = chess.turn() === "w" ? white : black;
    const opponent = chess.turn() === "w" ? black : white;

    let result: MoveResult;
    try {
      result = await getAgentMove(
        toAgentConfig(currentAgent),
        chess.fen(),
        moveHistory,
        opponent.name,
        opponent.elo,
        `gym-${matchId}`
      );
    } catch {
      break;
    }

    try {
      chess.move(result.san);
    } catch {
      const legalMoves = chess.moves();
      if (legalMoves.length > 0) {
        chess.move(legalMoves[0]);
        result.san = legalMoves[0];
      } else {
        break;
      }
    }

    moveHistory.push(result.san);

    const moveData: GymMove = {
      san: result.san,
      comment: result.comment,
      thinkingTime: result.thinkingTime,
      fen: chess.fen(),
      moveNumber: Math.ceil(moveNumber / 2),
      color: chess.turn() === "w" ? "b" : "w",
    };

    moves.push(moveData);
    match.fen = chess.fen();
    match.moves = [...moves];
    gymMatches.set(matchId, { ...match });

    moveNumber++;

    // Pace it for spectating
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Determine result
  let result: string;
  if (chess.isCheckmate()) {
    result = chess.turn() === "w" ? "0-1" : "1-0";
  } else {
    result = "1/2-1/2";
  }

  // Translate to agent perspective
  let agentResult: string;
  if (result === "1-0") {
    agentResult = agentIsWhite ? "win" : "loss";
  } else if (result === "0-1") {
    agentResult = agentIsWhite ? "loss" : "win";
  } else {
    agentResult = "draw";
  }

  match.status = "finished";
  match.result = agentResult;
  match.fen = chess.fen();
  match.moves = moves;
  gymMatches.set(matchId, { ...match });

  return match;
}
