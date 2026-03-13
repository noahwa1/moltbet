import { Chess } from "chess.js";
import { getDb } from "./db";
import { getAgentMove, updateElo, type MoveResult, type AgentConfig } from "./chess-engine";
import { distributeWinnings, recordLoss } from "./economics";
import { calculateLiveOdds, type LiveOdds } from "./live-odds";
import { v4 as uuid } from "uuid";

export interface GameState {
  id: string;
  white: AgentRecord;
  black: AgentRecord;
  status: "pending" | "live" | "finished";
  fen: string;
  moves: MoveWithComment[];
  result: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AgentRecord {
  id: string;
  name: string;
  type: string;
  model: string | null;
  personality: string | null;
  endpoint: string | null;
  api_key: string | null;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface MoveWithComment {
  san: string;
  comment: string;
  thinkingTime: number;
  fen: string;
  moveNumber: number;
  color: "w" | "b";
}

// In-memory store for active games being played
const activeGames = new Map<
  string,
  { moves: MoveWithComment[]; status: string; fen: string; liveOdds?: LiveOdds }
>();

export function getActiveGame(
  gameId: string
): { moves: MoveWithComment[]; status: string; fen: string; liveOdds?: LiveOdds } | undefined {
  return activeGames.get(gameId);
}

export function createGame(whiteId: string, blackId: string, scheduledAt?: Date): string {
  const db = getDb();
  const id = uuid();
  const scheduled = scheduledAt
    ? scheduledAt.toISOString().replace("T", " ").replace("Z", "").split(".")[0]
    : new Date().toISOString().replace("T", " ").replace("Z", "").split(".")[0];
  db.prepare(
    "INSERT INTO games (id, white_id, black_id, status, scheduled_at) VALUES (?, ?, ?, 'pending', ?)"
  ).run(id, whiteId, blackId, scheduled);
  return id;
}

function toAgentConfig(record: AgentRecord): AgentConfig {
  return {
    id: record.id,
    name: record.name,
    type: record.type === "external" ? "external" : "builtin",
    model: record.model ?? undefined,
    personality: record.personality ?? undefined,
    endpoint: record.endpoint ?? undefined,
    api_key: record.api_key ?? undefined,
  };
}

export async function playGame(
  gameId: string,
  onMove?: (move: MoveWithComment) => void
): Promise<GameState> {
  const db = getDb();
  const game = db
    .prepare(
      `
    SELECT g.*,
      w.id as w_id, w.name as w_name, w.type as w_type, w.model as w_model, w.personality as w_personality, w.endpoint as w_endpoint, w.api_key as w_api_key, w.avatar as w_avatar, w.elo as w_elo, w.wins as w_wins, w.losses as w_losses, w.draws as w_draws,
      b.id as b_id, b.name as b_name, b.type as b_type, b.model as b_model, b.personality as b_personality, b.endpoint as b_endpoint, b.api_key as b_api_key, b.avatar as b_avatar, b.elo as b_elo, b.wins as b_wins, b.losses as b_losses, b.draws as b_draws
    FROM games g
    JOIN agents w ON g.white_id = w.id
    JOIN agents b ON g.black_id = b.id
    WHERE g.id = ?
  `
    )
    .get(gameId) as Record<string, unknown>;

  if (!game) throw new Error("Game not found");

  const white: AgentRecord = {
    id: game.w_id as string,
    name: game.w_name as string,
    type: game.w_type as string,
    model: game.w_model as string | null,
    personality: game.w_personality as string | null,
    endpoint: game.w_endpoint as string | null,
    api_key: game.w_api_key as string | null,
    avatar: game.w_avatar as string,
    elo: game.w_elo as number,
    wins: game.w_wins as number,
    losses: game.w_losses as number,
    draws: game.w_draws as number,
  };

  const black: AgentRecord = {
    id: game.b_id as string,
    name: game.b_name as string,
    type: game.b_type as string,
    model: game.b_model as string | null,
    personality: game.b_personality as string | null,
    endpoint: game.b_endpoint as string | null,
    api_key: game.b_api_key as string | null,
    avatar: game.b_avatar as string,
    elo: game.b_elo as number,
    wins: game.b_wins as number,
    losses: game.b_losses as number,
    draws: game.b_draws as number,
  };

  const chess = new Chess();
  const moves: MoveWithComment[] = [];
  const moveHistory: string[] = [];

  // Update game status to live
  db.prepare(
    "UPDATE games SET status = 'live', started_at = datetime('now') WHERE id = ?"
  ).run(gameId);

  activeGames.set(gameId, { moves, status: "live", fen: chess.fen() });

  let moveNumber = 1;

  // Play the game
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
        gameId
      );
    } catch {
      break;
    }

    // Apply the move to our chess instance
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

    const moveData: MoveWithComment = {
      san: result.san,
      comment: result.comment,
      thinkingTime: result.thinkingTime,
      fen: chess.fen(),
      moveNumber: Math.ceil(moveNumber / 2),
      color: chess.turn() === "w" ? "b" : "w",
    };

    moves.push(moveData);

    // Recalculate live odds after each move
    const liveOdds = calculateLiveOdds(white.id, black.id, chess.fen(), moveHistory, gameId);
    activeGames.set(gameId, { moves: [...moves], status: "live", fen: chess.fen(), liveOdds });

    if (moveNumber % 4 === 0) {
      db.prepare("UPDATE games SET fen = ?, moves = ? WHERE id = ?").run(
        chess.fen(),
        JSON.stringify(moves),
        gameId
      );
    }

    if (onMove) onMove(moveData);
    moveNumber++;
  }

  // Determine result
  let result: string;
  if (chess.isCheckmate()) {
    result = chess.turn() === "w" ? "0-1" : "1-0";
  } else if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
    result = "1/2-1/2";
  } else {
    result = "1/2-1/2";
  }

  // Update game
  db.prepare(
    "UPDATE games SET status = 'finished', fen = ?, pgn = ?, moves = ?, result = ?, finished_at = datetime('now') WHERE id = ?"
  ).run(chess.fen(), chess.pgn(), JSON.stringify(moves), result, gameId);

  // Get prize pool
  const gameRow = db.prepare("SELECT prize_pool FROM games WHERE id = ?").get(gameId) as { prize_pool: number } | undefined;
  const prizePool = gameRow?.prize_pool ?? 500;

  // Update ELO, stats, and distribute earnings
  db.prepare("UPDATE agents SET games_played = games_played + 1 WHERE id IN (?, ?)").run(white.id, black.id);

  if (result === "1-0") {
    const { newWinnerElo, newLoserElo } = updateElo(white.elo, black.elo, false);
    db.prepare("UPDATE agents SET elo = ?, wins = wins + 1 WHERE id = ?").run(newWinnerElo, white.id);
    db.prepare("UPDATE agents SET elo = ?, losses = losses + 1 WHERE id = ?").run(newLoserElo, black.id);
    distributeWinnings(white.id, gameId, "chess", prizePool);
    recordLoss(black.id, gameId, "chess", Math.round(prizePool * 0.2));
  } else if (result === "0-1") {
    const { newWinnerElo, newLoserElo } = updateElo(black.elo, white.elo, false);
    db.prepare("UPDATE agents SET elo = ?, wins = wins + 1 WHERE id = ?").run(newWinnerElo, black.id);
    db.prepare("UPDATE agents SET elo = ?, losses = losses + 1 WHERE id = ?").run(newLoserElo, white.id);
    distributeWinnings(black.id, gameId, "chess", prizePool);
    recordLoss(white.id, gameId, "chess", Math.round(prizePool * 0.2));
  } else {
    const { newWinnerElo, newLoserElo } = updateElo(white.elo, black.elo, true);
    db.prepare("UPDATE agents SET elo = ?, draws = draws + 1, games_played = games_played WHERE id = ?").run(newWinnerElo, white.id);
    db.prepare("UPDATE agents SET elo = ?, draws = draws + 1, games_played = games_played WHERE id = ?").run(newLoserElo, black.id);
  }

  // Settle bets (pass total moves for O/U settlement)
  settleBets(gameId, result, moves.length, white.id, black.id);

  activeGames.set(gameId, { moves, status: "finished", fen: chess.fen() });

  return {
    id: gameId,
    white,
    black,
    status: "finished",
    fen: chess.fen(),
    moves,
    result,
    startedAt: null,
    finishedAt: null,
  };
}

function settleBets(gameId: string, result: string, totalMoves: number, whiteId: string, blackId: string) {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM bets WHERE game_id = ? AND status = 'pending'")
    .all(gameId) as Array<{
    id: string;
    user_id: string;
    agent_id: string;
    bet_type: string;
    line: number | null;
    side: string | null;
    amount: number;
    odds: number;
    game_id: string;
  }>;

  for (const bet of bets) {
    let won = false;

    if (bet.bet_type === "moneyline" || !bet.bet_type) {
      // Classic: did your agent win?
      if (result === "1-0" && bet.agent_id === whiteId) won = true;
      if (result === "0-1" && bet.agent_id === blackId) won = true;
    } else if (bet.bet_type === "spread") {
      // Spread -1.5: favorite must win outright to cover
      // side = "white" or "black" (the side the bettor picked)
      const bettorSideWon =
        (bet.side === "white" && result === "1-0") ||
        (bet.side === "black" && result === "0-1");
      const bettorSideDrew = result === "1/2-1/2";

      // Determine if bettor picked favorite or underdog based on their side vs spread favorite
      // If they bet on the favorite side, they need an outright win (cover -1.5)
      // If they bet on the underdog side, they win with draw or win (+1.5)
      const whiteElo = (db.prepare("SELECT elo FROM agents WHERE id = ?").get(whiteId) as { elo: number })?.elo ?? 1200;
      const blackElo = (db.prepare("SELECT elo FROM agents WHERE id = ?").get(blackId) as { elo: number })?.elo ?? 1200;
      const favoriteIsWhite = whiteElo >= blackElo;
      const bettorPickedFavorite =
        (bet.side === "white" && favoriteIsWhite) ||
        (bet.side === "black" && !favoriteIsWhite);

      if (bettorPickedFavorite) {
        // Must win outright to cover -1.5
        won = bettorSideWon;
      } else {
        // Underdog +1.5: win OR draw covers
        won = bettorSideWon || bettorSideDrew;
      }
    } else if (bet.bet_type === "over_under") {
      // Over/Under on total moves (half-moves)
      if (bet.line !== null) {
        if (bet.side === "over") {
          won = totalMoves > bet.line;
        } else {
          won = totalMoves < bet.line;
        }
      }
    }

    if (won) {
      const payout = Math.round(bet.amount * bet.odds);
      db.prepare("UPDATE bets SET status = 'won', payout = ? WHERE id = ?").run(
        payout,
        bet.id
      );
      db.prepare(
        "UPDATE users SET balance = balance + ?, total_won = total_won + ? WHERE id = ?"
      ).run(payout, payout, bet.user_id);
    } else {
      db.prepare("UPDATE bets SET status = 'lost', payout = 0 WHERE id = ?").run(
        bet.id
      );
      db.prepare(
        "UPDATE users SET total_lost = total_lost + ? WHERE id = ?"
      ).run(bet.amount, bet.user_id);
    }
  }
}
