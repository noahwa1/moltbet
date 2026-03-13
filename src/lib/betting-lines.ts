import { getDb } from "./db";
import { getActiveGame } from "./game-manager";
import { calculateLiveOdds } from "./live-odds";

export interface BettingLines {
  moneyline: {
    white: number; // decimal odds
    black: number;
    draw: number;
  };
  spread: {
    line: number; // e.g., -1.5 means favorite must win outright
    favorite: "white" | "black";
    favoriteOdds: number;
    underdogOdds: number;
    description: string;
  };
  overUnder: {
    line: number; // e.g., 45.5 total moves
    overOdds: number;
    underOdds: number;
  };
}

/**
 * Generate all betting lines for a game.
 * Lines shift based on ELO, live position eval, and game state.
 */
export function generateLines(
  gameId: string,
  whiteId: string,
  blackId: string,
  fen?: string,
  moveHistory?: string[]
): BettingLines {
  const db = getDb();

  const white = db.prepare("SELECT elo FROM agents WHERE id = ?").get(whiteId) as { elo: number } | undefined;
  const black = db.prepare("SELECT elo FROM agents WHERE id = ?").get(blackId) as { elo: number } | undefined;

  const whiteElo = white?.elo ?? 1200;
  const blackElo = black?.elo ?? 1200;
  const eloDiff = whiteElo - blackElo;

  // Try to get live odds if game is in progress
  const activeGame = getActiveGame(gameId);
  let liveOdds = activeGame?.liveOdds;

  if (!liveOdds && fen && moveHistory) {
    try {
      liveOdds = calculateLiveOdds(whiteId, blackId, fen, moveHistory, gameId);
    } catch {
      // Fall back to ELO-based
    }
  }

  // === MONEYLINE ===
  let moneyline: BettingLines["moneyline"];
  if (liveOdds) {
    moneyline = {
      white: liveOdds.white,
      black: liveOdds.black,
      draw: liveOdds.draw,
    };
  } else {
    const expectedWhite = 1 / (1 + Math.pow(10, (blackElo - whiteElo) / 400));
    const drawProb = 0.1;
    const whiteProb = expectedWhite * (1 - drawProb);
    const blackProb = (1 - expectedWhite) * (1 - drawProb);
    moneyline = {
      white: Math.max(1.05, parseFloat((1 / whiteProb).toFixed(2))),
      black: Math.max(1.05, parseFloat((1 / blackProb).toFixed(2))),
      draw: parseFloat((1 / drawProb).toFixed(2)),
    };
  }

  // === SPREAD ===
  // Chess spread: favorite must win outright (line -1.5), underdog covers with draw or win
  // With bigger ELO gaps, the spread line stays at -1.5 but odds shift
  const isFavoriteWhite = whiteElo >= blackElo;
  const favorite = isFavoriteWhite ? "white" as const : "black" as const;
  const absEloDiff = Math.abs(eloDiff);

  // Base spread line is always -1.5 for chess (must win, no push on draw)
  // But we adjust odds based on how likely that is
  let favoriteWinProb: number;
  if (liveOdds) {
    favoriteWinProb = isFavoriteWhite ? liveOdds.whiteWinProb : liveOdds.blackWinProb;
  } else {
    const expectedFav = 1 / (1 + Math.pow(10, -absEloDiff / 400));
    favoriteWinProb = expectedFav * 0.9; // account for draws
  }

  // Spread odds: favorite covers at -1.5 = must win outright
  const spreadFavOdds = Math.max(1.05, parseFloat((1 / favoriteWinProb).toFixed(2)));
  // Underdog covers if they win or draw
  const underdogCoverProb = 1 - favoriteWinProb;
  const spreadDogOdds = Math.max(1.05, parseFloat((1 / underdogCoverProb).toFixed(2)));

  const favName = isFavoriteWhite ? "White" : "Black";
  const dogName = isFavoriteWhite ? "Black" : "White";

  const spread: BettingLines["spread"] = {
    line: -1.5,
    favorite,
    favoriteOdds: spreadFavOdds,
    underdogOdds: spreadDogOdds,
    description: `${favName} -1.5 (must win) vs ${dogName} +1.5 (win or draw)`,
  };

  // === OVER/UNDER ===
  // Base line: average chess game is ~40 moves (80 half-moves)
  // Higher ELO = longer games typically. Bigger mismatch = shorter games.
  let baseMoves = 80; // half-moves
  // Adjust for skill level
  const avgElo = (whiteElo + blackElo) / 2;
  baseMoves += (avgElo - 1200) * 0.03; // higher rated = slightly longer
  // Adjust for mismatch (big mismatch = shorter game)
  baseMoves -= absEloDiff * 0.05;
  // Clamp
  baseMoves = Math.max(30, Math.min(120, baseMoves));

  // If game is in progress, adjust based on current move count
  const currentMoves = moveHistory?.length ?? 0;
  if (currentMoves > 0) {
    // Remaining moves estimate
    const remaining = Math.max(10, baseMoves - currentMoves);
    baseMoves = currentMoves + remaining;
  }

  // Round to .5 to prevent pushes
  const ouLine = Math.round(baseMoves) + 0.5;

  // O/U odds: slight juice on both sides
  // Adjust based on position - if position is sharp/tactical, game likely shorter
  let overBias = 0.5; // 0.5 = even
  if (liveOdds) {
    // Sharp positions (high eval) tend to end sooner
    const sharpness = Math.abs(liveOdds.evaluation);
    overBias -= sharpness * 0.03; // more decisive = lean under
    overBias = Math.max(0.3, Math.min(0.7, overBias));
  }

  const overOdds = Math.max(1.05, parseFloat((1 / overBias).toFixed(2)));
  const underOdds = Math.max(1.05, parseFloat((1 / (1 - overBias)).toFixed(2)));

  const overUnder: BettingLines["overUnder"] = {
    line: ouLine,
    overOdds,
    underOdds,
  };

  return { moneyline, spread, overUnder };
}
