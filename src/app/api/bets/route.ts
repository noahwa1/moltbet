import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateLines } from "@/lib/betting-lines";
import { v4 as uuid } from "uuid";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    gameId,
    agentId,
    amount,
    betType = "moneyline",
    side,
  } = body;
  const userId = "default-user";

  const db = getDb();

  // Validate game exists and is still bettable
  const game = db
    .prepare("SELECT * FROM games WHERE id = ? AND status IN ('pending', 'live')")
    .get(gameId) as {
    id: string;
    white_id: string;
    black_id: string;
    status: string;
    fen: string;
    moves: string;
  } | undefined;

  if (!game) {
    return NextResponse.json({ error: "Game not available for betting" }, { status: 400 });
  }

  // Check user balance
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as { balance: number } | undefined;
  if (!user || user.balance < amount) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
  }

  if (amount < 10) {
    return NextResponse.json({ error: "Minimum bet is 10 coins" }, { status: 400 });
  }

  // Get current move history for live lines
  let moveHistory: string[] = [];
  try {
    const moves = JSON.parse(game.moves || "[]");
    moveHistory = moves.map((m: { san: string }) => m.san);
  } catch { /* empty */ }

  // Generate current lines
  const lines = generateLines(gameId, game.white_id, game.black_id, game.fen, moveHistory);

  let odds: number;
  let line: number | null = null;
  let betSide: string | null = null;

  if (betType === "moneyline") {
    // Validate agent is in this game
    if (agentId !== game.white_id && agentId !== game.black_id) {
      return NextResponse.json({ error: "Agent not in this game" }, { status: 400 });
    }
    odds = agentId === game.white_id ? lines.moneyline.white : lines.moneyline.black;
    betSide = agentId === game.white_id ? "white" : "black";
  } else if (betType === "spread") {
    // side = "favorite" or "underdog"
    if (side !== "favorite" && side !== "underdog") {
      return NextResponse.json({ error: "Spread bet requires side: 'favorite' or 'underdog'" }, { status: 400 });
    }
    odds = side === "favorite" ? lines.spread.favoriteOdds : lines.spread.underdogOdds;
    line = lines.spread.line;
    betSide = side === "favorite" ? lines.spread.favorite : (lines.spread.favorite === "white" ? "black" : "white");
  } else if (betType === "over_under") {
    // side = "over" or "under"
    if (side !== "over" && side !== "under") {
      return NextResponse.json({ error: "O/U bet requires side: 'over' or 'under'" }, { status: 400 });
    }
    odds = side === "over" ? lines.overUnder.overOdds : lines.overUnder.underOdds;
    line = lines.overUnder.line;
    betSide = side;
  } else {
    return NextResponse.json({ error: "Invalid bet type. Use: moneyline, spread, over_under" }, { status: 400 });
  }

  // Place bet
  const betId = uuid();
  db.prepare(
    "INSERT INTO bets (id, user_id, game_id, agent_id, bet_type, line, side, amount, odds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(betId, userId, gameId, agentId ?? null, betType, line, betSide, amount, odds);

  // Deduct from balance
  db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(amount, userId);

  return NextResponse.json({ betId, betType, odds, line, side: betSide, amount });
}
