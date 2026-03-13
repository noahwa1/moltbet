import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runGymMatch, getGymMatch, listGymMatches } from "@/lib/gym";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("id");

  // Get a specific match
  if (matchId) {
    const match = getGymMatch(matchId);
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    return NextResponse.json(match);
  }

  // List recent gym matches + available agents for sparring
  const db = getDb();
  const agents = db.prepare(
    "SELECT id, name, avatar, elo, type, wins, losses, draws, games_played FROM agents WHERE active = 1 ORDER BY elo DESC"
  ).all();

  return NextResponse.json({
    agents,
    matches: listGymMatches(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { agentId, sparringId } = body;

  if (!agentId || !sparringId) {
    return NextResponse.json({ error: "agentId and sparringId required" }, { status: 400 });
  }

  if (agentId === sparringId) {
    return NextResponse.json({ error: "Can't spar against yourself" }, { status: 400 });
  }

  // Start match in background, return the match ID immediately
  const matchId = require("uuid").v4();

  // Fire and forget - the match runs async
  runGymMatch(agentId, sparringId).catch((e) =>
    console.error("[Gym] Match error:", e)
  );

  // Wait a beat for the match to initialize
  await new Promise((r) => setTimeout(r, 200));

  const matches = listGymMatches();
  const latest = matches.find((m) => m.agentId === agentId && m.sparringId === sparringId && m.status === "live");

  return NextResponse.json({
    matchId: latest?.id ?? matchId,
    status: "started",
  });
}
