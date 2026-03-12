import { Chess } from "chess.js";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const EXTERNAL_TIMEOUT_MS = 10_000;

export interface AgentConfig {
  id: string;
  name: string;
  type: "builtin" | "external";
  // Builtin agents
  model?: string;
  personality?: string;
  // External agents
  endpoint?: string;
  api_key?: string;
}

export interface MoveResult {
  move: string;
  san: string;
  comment: string;
  thinkingTime: number;
  fen: string;
}

// The payload we send to external agent endpoints
export interface AgentRequest {
  game_id: string;
  fen: string;
  legal_moves: string[];
  move_history: string[];
  opponent: { name: string; elo: number };
  your_color: "white" | "black";
  time_limit_ms: number;
}

// What we expect back
export interface AgentResponse {
  move: string;
  comment?: string;
}

export async function getAgentMove(
  agent: AgentConfig,
  fen: string,
  moveHistory: string[],
  opponentName: string,
  opponentElo?: number,
  gameId?: string
): Promise<MoveResult> {
  if (agent.type === "external" && agent.endpoint) {
    return getExternalAgentMove(agent, fen, moveHistory, opponentName, opponentElo ?? 1200, gameId ?? "");
  }
  return getBuiltinAgentMove(agent, fen, moveHistory, opponentName);
}

async function getExternalAgentMove(
  agent: AgentConfig,
  fen: string,
  moveHistory: string[],
  opponentName: string,
  opponentElo: number,
  gameId: string
): Promise<MoveResult> {
  const chess = new Chess(fen);
  const legalMoves = chess.moves();
  const color = chess.turn() === "w" ? "white" : "black";
  const start = Date.now();

  const payload: AgentRequest = {
    game_id: gameId,
    fen,
    legal_moves: legalMoves,
    move_history: moveHistory,
    opponent: { name: opponentName, elo: opponentElo },
    your_color: color,
    time_limit_ms: EXTERNAL_TIMEOUT_MS,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (agent.api_key) {
      headers["Authorization"] = `Bearer ${agent.api_key}`;
    }

    const res = await fetch(agent.endpoint!, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const thinkingTime = Date.now() - start;

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}: ${await res.text()}`);
    }

    const data: AgentResponse = await res.json();

    // Validate the move
    let chosenMove = data.move;
    try {
      chess.move(chosenMove);
    } catch {
      // Try case-insensitive match
      const match = legalMoves.find(
        (m) => m.toLowerCase() === chosenMove.toLowerCase()
      );
      if (match) {
        chess.move(match);
        chosenMove = match;
      } else {
        // Invalid move from external agent - forfeit the move with a random one
        console.warn(
          `[External Agent ${agent.name}] Invalid move "${chosenMove}", falling back to random`
        );
        chosenMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        chess.move(chosenMove);
      }
    }

    return {
      move: chosenMove,
      san: chosenMove,
      comment: data.comment || "",
      thinkingTime,
      fen: chess.fen(),
    };
  } catch (error) {
    const thinkingTime = Date.now() - start;
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    console.error(
      `[External Agent ${agent.name}] ${isTimeout ? "Timeout" : "Error"}: ${error}`
    );

    // Fallback to random move on error
    const fallbackMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    chess.move(fallbackMove);
    return {
      move: fallbackMove,
      san: fallbackMove,
      comment: isTimeout
        ? "*timed out - random move*"
        : `*connection error - random move*`,
      thinkingTime,
      fen: chess.fen(),
    };
  }
}

async function getBuiltinAgentMove(
  agent: AgentConfig,
  fen: string,
  moveHistory: string[],
  opponentName: string
): Promise<MoveResult> {
  const chess = new Chess(fen);
  const legalMoves = chess.moves();
  const color = chess.turn() === "w" ? "White" : "Black";

  const start = Date.now();

  const prompt = `You are playing chess as ${color}. ${agent.personality}

Current position (FEN): ${fen}
Move history: ${moveHistory.length > 0 ? moveHistory.join(", ") : "Game just started"}
Your opponent: ${opponentName}

Legal moves available: ${legalMoves.join(", ")}

You MUST respond with EXACTLY this JSON format, nothing else:
{"move": "<your chosen move in SAN notation from the legal moves list>", "comment": "<a brief in-character comment about your move, max 100 chars>"}

IMPORTANT: Your move MUST be one of the legal moves listed above. Pick the best move you can.`;

  try {
    const response = await client.messages.create({
      model: agent.model!,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const thinkingTime = Date.now() - start;

    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      const fallbackMove =
        legalMoves[Math.floor(Math.random() * legalMoves.length)];
      chess.move(fallbackMove);
      return {
        move: fallbackMove,
        san: fallbackMove,
        comment: "*contemplates silently*",
        thinkingTime,
        fen: chess.fen(),
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    let chosenMove = parsed.move;

    try {
      chess.move(chosenMove);
    } catch {
      const closestMove = legalMoves.find(
        (m) => m.toLowerCase() === chosenMove.toLowerCase()
      );
      if (closestMove) {
        chess.move(closestMove);
        chosenMove = closestMove;
      } else {
        chosenMove =
          legalMoves[Math.floor(Math.random() * legalMoves.length)];
        chess.move(chosenMove);
      }
    }

    return {
      move: chosenMove,
      san: chosenMove,
      comment: parsed.comment || "",
      thinkingTime,
      fen: chess.fen(),
    };
  } catch (error) {
    const thinkingTime = Date.now() - start;
    const fallbackMove =
      legalMoves[Math.floor(Math.random() * legalMoves.length)];
    chess.move(fallbackMove);
    return {
      move: fallbackMove,
      san: fallbackMove,
      comment: `*connection issues* (${error instanceof Error ? error.message : "unknown error"})`,
      thinkingTime,
      fen: chess.fen(),
    };
  }
}

export function calculateOdds(
  elo1: number,
  elo2: number
): { white: number; black: number; draw: number } {
  const expectedWhite = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));

  const drawProb = 0.1;
  const whiteProb = expectedWhite * (1 - drawProb);
  const blackProb = (1 - expectedWhite) * (1 - drawProb);

  return {
    white: Math.max(1.05, parseFloat((1 / whiteProb).toFixed(2))),
    black: Math.max(1.05, parseFloat((1 / blackProb).toFixed(2))),
    draw: parseFloat((1 / drawProb).toFixed(2)),
  };
}

export function updateElo(
  winnerElo: number,
  loserElo: number,
  isDraw: boolean
): { newWinnerElo: number; newLoserElo: number } {
  const K = 32;
  const expectedWinner =
    1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 - expectedWinner;

  if (isDraw) {
    return {
      newWinnerElo: Math.round(winnerElo + K * (0.5 - expectedWinner)),
      newLoserElo: Math.round(loserElo + K * (0.5 - expectedLoser)),
    };
  }

  return {
    newWinnerElo: Math.round(winnerElo + K * (1 - expectedWinner)),
    newLoserElo: Math.round(loserElo + K * (0 - expectedLoser)),
  };
}
