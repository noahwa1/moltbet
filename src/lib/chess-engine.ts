import { Chess } from "chess.js";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  personality: string;
}

export interface MoveResult {
  move: string;
  san: string;
  comment: string;
  thinkingTime: number;
  fen: string;
}

export async function getAgentMove(
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
      model: agent.model,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const thinkingTime = Date.now() - start;

    // Parse the JSON response
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      // Fallback: pick a random legal move
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

    // Validate the move
    try {
      chess.move(chosenMove);
    } catch {
      // If invalid, try to find a close match
      const closestMove = legalMoves.find(
        (m) => m.toLowerCase() === chosenMove.toLowerCase()
      );
      if (closestMove) {
        chess.move(closestMove);
        chosenMove = closestMove;
      } else {
        // Last resort: random legal move
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
    // On API error, make a random move
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
  const expectedBlack = 1 - expectedWhite;

  // Add a small draw probability
  const drawProb = 0.1;
  const whiteProb = expectedWhite * (1 - drawProb);
  const blackProb = expectedBlack * (1 - drawProb);

  // Convert to decimal odds (minimum 1.05)
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
