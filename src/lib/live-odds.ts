import { Chess } from "chess.js";
import { getDb } from "./db";

export interface LiveOdds {
  white: number;
  black: number;
  draw: number;
  whiteWinProb: number;
  blackWinProb: number;
  drawProb: number;
  evaluation: number; // positive = white advantage, negative = black
  momentum: "white" | "black" | "neutral";
}

export interface OddsSnapshot {
  moveNumber: number;
  white: number;
  black: number;
  evaluation: number;
  timestamp: number;
}

// In-memory odds history per game
const oddsHistory = new Map<string, OddsSnapshot[]>();

export function getOddsHistory(gameId: string): OddsSnapshot[] {
  return oddsHistory.get(gameId) ?? [];
}

/**
 * Calculate live odds based on:
 * 1. Base ELO difference
 * 2. Current board evaluation (material, position)
 * 3. Recent form (last 10 games win rate)
 * 4. Head-to-head record
 * 5. Game phase (opening/middlegame/endgame)
 */
export function calculateLiveOdds(
  whiteId: string,
  blackId: string,
  fen: string,
  moveHistory: string[],
  gameId: string
): LiveOdds {
  const db = getDb();

  // 1. Base ELO probability
  const white = db.prepare("SELECT elo FROM agents WHERE id = ?").get(whiteId) as { elo: number };
  const black = db.prepare("SELECT elo FROM agents WHERE id = ?").get(blackId) as { elo: number };
  const eloProbWhite = 1 / (1 + Math.pow(10, ((black?.elo ?? 1200) - (white?.elo ?? 1200)) / 400));

  // 2. Board evaluation
  const evaluation = evaluatePosition(fen);

  // 3. Recent form (last 10 games)
  const whiteForm = getRecentForm(whiteId);
  const blackForm = getRecentForm(blackId);

  // 4. Head-to-head
  const h2h = getHeadToHead(whiteId, blackId);

  // 5. Game phase multiplier — evaluation matters more as game progresses
  const moveCount = moveHistory.length;
  const phaseMultiplier = moveCount < 10 ? 0.3 : moveCount < 30 ? 0.6 : 0.9;

  // Combine factors
  // Evaluation sigmoid: convert centipawn-like eval to probability shift
  const evalShift = sigmoid(evaluation * 0.3) - 0.5; // -0.5 to 0.5 range

  // Form bonus: slight adjustment based on hot/cold streak
  const formDiff = (whiteForm - blackForm) * 0.05; // max ~0.05 shift

  // H2H bonus: slight edge if you historically dominate
  const h2hShift = h2h.total > 0
    ? ((h2h.whiteWins / h2h.total) - 0.5) * 0.08
    : 0;

  // Combined white win probability
  let whiteWinProb = eloProbWhite
    + evalShift * phaseMultiplier
    + formDiff
    + h2hShift;

  // Check for checkmate/stalemate
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    whiteWinProb = chess.turn() === "w" ? 0.01 : 0.99;
  } else if (chess.isDraw() || chess.isStalemate()) {
    whiteWinProb = 0.5;
  }

  // Clamp
  whiteWinProb = Math.max(0.02, Math.min(0.98, whiteWinProb));

  // Draw probability: higher in equal positions, lower when one side dominates
  const equalness = 1 - Math.abs(whiteWinProb - 0.5) * 2;
  const baseDraw = 0.08;
  const drawProb = Math.min(0.3, baseDraw + equalness * 0.12);

  // Adjust win probs to account for draw
  const adjustedWhite = whiteWinProb * (1 - drawProb);
  const adjustedBlack = (1 - whiteWinProb) * (1 - drawProb);

  // Convert to decimal odds
  const whiteOdds = Math.max(1.02, parseFloat((1 / adjustedWhite).toFixed(2)));
  const blackOdds = Math.max(1.02, parseFloat((1 / adjustedBlack).toFixed(2)));
  const drawOdds = parseFloat((1 / drawProb).toFixed(2));

  // Determine momentum
  const history = oddsHistory.get(gameId) ?? [];
  let momentum: "white" | "black" | "neutral" = "neutral";
  if (history.length >= 3) {
    const recent = history.slice(-3);
    const evalTrend = recent[recent.length - 1].evaluation - recent[0].evaluation;
    if (evalTrend > 0.5) momentum = "white";
    else if (evalTrend < -0.5) momentum = "black";
  }

  // Record snapshot
  const snapshot: OddsSnapshot = {
    moveNumber: moveHistory.length,
    white: whiteOdds,
    black: blackOdds,
    evaluation,
    timestamp: Date.now(),
  };

  if (!oddsHistory.has(gameId)) {
    oddsHistory.set(gameId, []);
  }
  oddsHistory.get(gameId)!.push(snapshot);

  return {
    white: whiteOdds,
    black: blackOdds,
    draw: drawOdds,
    whiteWinProb: adjustedWhite,
    blackWinProb: adjustedBlack,
    drawProb,
    evaluation,
    momentum,
  };
}

/**
 * Simple but effective board evaluation.
 * Returns a score: positive = white advantage, negative = black.
 * Considers material, piece activity, king safety, pawn structure.
 */
function evaluatePosition(fen: string): number {
  const chess = new Chess(fen);
  const board = chess.board();

  const pieceValues: Record<string, number> = {
    p: 1, n: 3, b: 3.25, r: 5, q: 9, k: 0,
  };

  // Center squares bonus
  const centerBonus: Record<string, number> = {};
  const centerSquares = ["d4", "d5", "e4", "e5"];
  const nearCenter = ["c3", "c4", "c5", "c6", "d3", "d6", "e3", "e6", "f3", "f4", "f5", "f6"];
  for (const sq of centerSquares) centerBonus[sq] = 0.3;
  for (const sq of nearCenter) centerBonus[sq] = 0.1;

  let score = 0;
  let whiteMobility = 0;
  let blackMobility = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const value = pieceValues[piece.type] || 0;
      const file = String.fromCharCode(97 + c);
      const rank = 8 - r;
      const sq = `${file}${rank}`;
      const posBonus = centerBonus[sq] || 0;

      if (piece.color === "w") {
        score += value + posBonus;
        // Advancement bonus for pawns
        if (piece.type === "p") {
          score += (rank - 2) * 0.05;
        }
      } else {
        score -= value + posBonus;
        if (piece.type === "p") {
          score -= (7 - rank) * 0.05;
        }
      }
    }
  }

  // Mobility (number of legal moves is a proxy for activity)
  const currentTurn = chess.turn();
  const currentMoves = chess.moves().length;

  if (currentTurn === "w") {
    whiteMobility = currentMoves;
    // Estimate black mobility (rough)
    blackMobility = 20; // Average approximation
  } else {
    blackMobility = currentMoves;
    whiteMobility = 20;
  }

  score += (whiteMobility - blackMobility) * 0.03;

  // Check bonus
  if (chess.inCheck()) {
    score += currentTurn === "w" ? -0.3 : 0.3;
  }

  return score;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function getRecentForm(agentId: string): number {
  const db = getDb();
  const recent = db.prepare(
    `SELECT result, white_id FROM games
     WHERE (white_id = ? OR black_id = ?) AND status = 'finished'
     ORDER BY finished_at DESC LIMIT 10`
  ).all(agentId, agentId) as { result: string; white_id: string }[];

  if (recent.length === 0) return 0.5;

  let wins = 0;
  for (const g of recent) {
    if (g.result === "1-0" && g.white_id === agentId) wins++;
    else if (g.result === "0-1" && g.white_id !== agentId) wins++;
  }

  return wins / recent.length;
}

function getHeadToHead(whiteId: string, blackId: string): {
  total: number;
  whiteWins: number;
  blackWins: number;
} {
  const db = getDb();
  const games = db.prepare(
    `SELECT result, white_id FROM games
     WHERE ((white_id = ? AND black_id = ?) OR (white_id = ? AND black_id = ?))
     AND status = 'finished'`
  ).all(whiteId, blackId, blackId, whiteId) as { result: string; white_id: string }[];

  let whiteWins = 0;
  let blackWins = 0;
  for (const g of games) {
    const whiteInThisGame = g.white_id === whiteId;
    if (g.result === "1-0") {
      if (whiteInThisGame) whiteWins++;
      else blackWins++;
    } else if (g.result === "0-1") {
      if (whiteInThisGame) blackWins++;
      else whiteWins++;
    }
  }

  return { total: games.length, whiteWins, blackWins };
}
