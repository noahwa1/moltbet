import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { Chess } from "chess.js";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, endpoint, avatar, apiKey, gameModes, owner_id } = body;

  const { getCurrentUser } = await import("@/lib/auth");
  const authUser = getCurrentUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Sign in to register agents" }, { status: 401 });
  }
  const resolvedOwnerId = authUser.id;

  if (!name || !endpoint) {
    return NextResponse.json(
      { error: "name and endpoint are required" },
      { status: 400 }
    );
  }

  if (name.length > 30) {
    return NextResponse.json(
      { error: "name must be 30 characters or less" },
      { status: 400 }
    );
  }

  // Validate the endpoint by sending a test request
  try {
    const chess = new Chess();
    const testPayload = {
      game_id: "test-" + uuid(),
      fen: chess.fen(),
      legal_moves: chess.moves(),
      move_history: [],
      opponent: { name: "Test Opponent", elo: 1200 },
      your_color: "white",
      time_limit_ms: 10000,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(testPayload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Endpoint returned ${res.status}. Your agent must return 200 with {move, comment?}`,
        },
        { status: 400 }
      );
    }

    const data = await res.json();

    if (!data.move) {
      return NextResponse.json(
        {
          error:
            'Endpoint must return JSON with a "move" field. Got: ' +
            JSON.stringify(data).slice(0, 200),
        },
        { status: 400 }
      );
    }

    // Validate the move is legal
    const isLegal = chess.moves().some(
      (m) => m.toLowerCase() === data.move.toLowerCase()
    );

    if (!isLegal) {
      return NextResponse.json(
        {
          error: `Endpoint returned invalid move "${data.move}". Must be one of: ${chess.moves().join(", ")}`,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    const isTimeout =
      error instanceof DOMException && error.name === "AbortError";
    return NextResponse.json(
      {
        error: isTimeout
          ? "Endpoint timed out (10s limit). Make sure your agent responds quickly."
          : `Could not reach endpoint: ${error instanceof Error ? error.message : "unknown error"}`,
      },
      { status: 400 }
    );
  }

  // All good - register the agent
  const db = getDb();
  const id = uuid();
  const agentAvatar = avatar || "🤖";

  const validModes = ["chess", "poker", "battleground"];
  const selectedModes = Array.isArray(gameModes)
    ? gameModes.filter((m: string) => validModes.includes(m))
    : validModes;
  if (selectedModes.length === 0) selectedModes.push("chess");

  db.prepare(
    `INSERT INTO agents (id, name, type, endpoint, api_key, avatar, elo, game_modes, active, owner_id)
     VALUES (?, ?, 'external', ?, ?, ?, 1200, ?, 1, ?)`
  ).run(id, name, endpoint, apiKey || null, agentAvatar, JSON.stringify(selectedModes), resolvedOwnerId);

  return NextResponse.json({
    id,
    name,
    type: "external",
    endpoint,
    avatar: agentAvatar,
    elo: 1200,
    gameModes: selectedModes,
    message: `Agent registered for ${selectedModes.join(", ")}! It will be scheduled automatically.`,
  });
}
