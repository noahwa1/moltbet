import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createGame } from "@/lib/game-manager";
import { playGame } from "@/lib/game-manager";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { agentId, opponentId, gameType } = body;

  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const db = getDb();
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as { id: string; name: string } | undefined;

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const type = gameType || "chess";

  if (type === "chess") {
    // If opponent specified, use them. Otherwise pick a random opponent.
    let opponent: { id: string; name: string };
    if (opponentId) {
      const opp = db.prepare("SELECT id, name FROM agents WHERE id = ?").get(opponentId) as { id: string; name: string } | undefined;
      if (!opp) return NextResponse.json({ error: "Opponent not found" }, { status: 404 });
      opponent = opp;
    } else {
      const others = db
        .prepare("SELECT id, name FROM agents WHERE id != ? AND active = 1")
        .all(agentId) as { id: string; name: string }[];
      if (others.length === 0) {
        return NextResponse.json({ error: "No opponents available" }, { status: 400 });
      }
      opponent = others[Math.floor(Math.random() * others.length)];
    }

    // Randomly assign colors
    const [white, black] = Math.random() > 0.5
      ? [agentId, opponent.id]
      : [opponent.id, agentId];

    const scheduledAt = new Date();
    scheduledAt.setSeconds(scheduledAt.getSeconds() + 10); // Start in 10 seconds

    const gameId = createGame(white, black, scheduledAt);

    return NextResponse.json({
      gameId,
      gameType: "chess",
      message: `${agent.name} vs ${opponent.name} starting in 10 seconds`,
    });
  }

  if (type === "poker") {
    // Pick 2-4 random opponents
    const others = db
      .prepare("SELECT id, name, avatar FROM agents WHERE id != ? AND active = 1")
      .all(agentId) as { id: string; name: string; avatar: string }[];

    const opponentCount = Math.min(others.length, 2 + Math.floor(Math.random() * 3));
    const opponents = others.sort(() => Math.random() - 0.5).slice(0, opponentCount);

    const agentInfo = db.prepare("SELECT id, name, avatar FROM agents WHERE id = ?").get(agentId) as { id: string; name: string; avatar: string };

    const allPlayers = [
      { agentId: agentInfo.id, name: agentInfo.name, avatar: agentInfo.avatar },
      ...opponents.map(o => ({ agentId: o.id, name: o.name, avatar: o.avatar })),
    ].sort(() => Math.random() - 0.5); // Shuffle seating

    const { v4: uuid } = await import("uuid");
    const id = uuid();
    const scheduledAt = new Date();
    scheduledAt.setSeconds(scheduledAt.getSeconds() + 10);
    const formatted = scheduledAt.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

    db.prepare(
      "INSERT INTO poker_games (id, status, players, scheduled_at) VALUES (?, 'pending', ?, ?)"
    ).run(id, JSON.stringify(allPlayers), formatted);

    return NextResponse.json({
      gameId: id,
      gameType: "poker",
      message: `Poker table with ${allPlayers.length} players starting in 10 seconds`,
    });
  }

  if (type === "battleground") {
    const others = db
      .prepare("SELECT id, name, avatar FROM agents WHERE id != ? AND active = 1")
      .all(agentId) as { id: string; name: string; avatar: string }[];

    if (others.length < 3) {
      return NextResponse.json({ error: "Need at least 4 agents total for battleground" }, { status: 400 });
    }

    // Pick 3 more agents, put requester + 1 on team A, other 2 on team B
    const selected = others.sort(() => Math.random() - 0.5).slice(0, 3);
    const agentInfo = db.prepare("SELECT id, name, avatar FROM agents WHERE id = ?").get(agentId) as { id: string; name: string; avatar: string };

    const teamA = [agentInfo, selected[0]];
    const teamB = [selected[1], selected[2]];

    const { v4: uuid } = await import("uuid");
    const id = uuid();
    const scheduledAt = new Date();
    scheduledAt.setSeconds(scheduledAt.getSeconds() + 10);
    const formatted = scheduledAt.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

    db.prepare(
      "INSERT INTO battleground_games (id, status, team_a, team_b, scheduled_at) VALUES (?, 'pending', ?, ?, ?)"
    ).run(id, JSON.stringify(teamA), JSON.stringify(teamB), formatted);

    return NextResponse.json({
      gameId: id,
      gameType: "battleground",
      message: `Battleground 2v2 starting in 10 seconds`,
    });
  }

  // Generic 1v1 games: connect4, checkers, othello, prisoners-dilemma
  const oneVsOneGames: Record<string, string> = {
    connect4: "connect4_games",
    checkers: "checkers_games",
    othello: "othello_games",
    "prisoners-dilemma": "prisoners_dilemma_games",
  };

  if (oneVsOneGames[type]) {
    const table = oneVsOneGames[type];
    let opponent: { id: string; name: string };
    if (opponentId) {
      const opp = db.prepare("SELECT id, name FROM agents WHERE id = ?").get(opponentId) as { id: string; name: string } | undefined;
      if (!opp) return NextResponse.json({ error: "Opponent not found" }, { status: 404 });
      opponent = opp;
    } else {
      const others = db.prepare("SELECT id, name FROM agents WHERE id != ? AND active = 1").all(agentId) as { id: string; name: string }[];
      if (others.length === 0) return NextResponse.json({ error: "No opponents available" }, { status: 400 });
      opponent = others[Math.floor(Math.random() * others.length)];
    }

    const { v4: uuid } = await import("uuid");
    const id = uuid();
    const scheduledAt = new Date();
    scheduledAt.setSeconds(scheduledAt.getSeconds() + 10);
    const formatted = scheduledAt.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

    const [pA, pB] = Math.random() > 0.5 ? [agentId, opponent.id] : [opponent.id, agentId];
    db.prepare(`INSERT INTO ${table} (id, status, player_a, player_b, scheduled_at) VALUES (?, 'pending', ?, ?, ?)`).run(id, pA, pB, formatted);

    return NextResponse.json({
      gameId: id,
      gameType: type,
      message: `${agent.name} vs ${opponent.name} (${type}) starting in 10 seconds`,
    });
  }

  // Generic multiplayer games: liars-dice, debate, trivia, auction
  const multiGames: Record<string, { table: string; min: number; max: number }> = {
    "liars-dice": { table: "liars_dice_games", min: 3, max: 5 },
    debate: { table: "debate_games", min: 2, max: 2 },
    trivia: { table: "trivia_games", min: 3, max: 5 },
    auction: { table: "auction_games", min: 3, max: 5 },
  };

  if (multiGames[type]) {
    const { table, min, max } = multiGames[type];
    const others = db.prepare("SELECT id, name, avatar FROM agents WHERE id != ? AND active = 1").all(agentId) as { id: string; name: string; avatar: string }[];

    if (others.length < min - 1) {
      return NextResponse.json({ error: `Need at least ${min} agents for ${type}` }, { status: 400 });
    }

    const opponentCount = Math.min(others.length, min - 1 + Math.floor(Math.random() * (max - min + 1)));
    const opponents = others.sort(() => Math.random() - 0.5).slice(0, opponentCount);
    const agentInfo = db.prepare("SELECT id, name, avatar FROM agents WHERE id = ?").get(agentId) as { id: string; name: string; avatar: string };

    const allPlayers = [
      { agentId: agentInfo.id, name: agentInfo.name, avatar: agentInfo.avatar },
      ...opponents.map(o => ({ agentId: o.id, name: o.name, avatar: o.avatar })),
    ].sort(() => Math.random() - 0.5);

    const { v4: uuid } = await import("uuid");
    const id = uuid();
    const scheduledAt = new Date();
    scheduledAt.setSeconds(scheduledAt.getSeconds() + 10);
    const formatted = scheduledAt.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

    db.prepare(`INSERT INTO ${table} (id, status, players, scheduled_at) VALUES (?, 'pending', ?, ?)`).run(id, JSON.stringify(allPlayers), formatted);

    return NextResponse.json({
      gameId: id,
      gameType: type,
      message: `${type} with ${allPlayers.length} players starting in 10 seconds`,
    });
  }

  return NextResponse.json({ error: "Invalid game type" }, { status: 400 });
}
