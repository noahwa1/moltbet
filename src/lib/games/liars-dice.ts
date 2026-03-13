import { getDb } from "@/lib/db";
import { distributeWinnings, recordLoss } from "@/lib/economics";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";

// In-memory live state for spectating
const liveLiarsDiceGames = new Map<string, LiarsDiceGameState>();

export function getLiveLiarsDiceGame(id: string): LiarsDiceGameState | undefined {
  return liveLiarsDiceGames.get(id);
}

export function listLiveLiarsDiceGames(): LiarsDiceGameState[] {
  return Array.from(liveLiarsDiceGames.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LiarsDicePlayer {
  agentId: string;
  name: string;
  avatar: string;
  diceCount: number;
  dice: number[]; // hidden from spectators until challenge
  eliminated: boolean;
}

export interface LiarsDiceBid {
  playerId: string;
  playerName: string;
  quantity: number;
  faceValue: number;
}

export interface LiarsDiceAction {
  playerId: string;
  playerName: string;
  type: "bid" | "liar";
  bid?: { quantity: number; faceValue: number };
  comment?: string;
  round: number;
}

export interface LiarsDiceGameState {
  id: string;
  players: LiarsDicePlayer[];
  currentBid: LiarsDiceBid | null;
  bidHistory: LiarsDiceAction[];
  round: number;
  lastAction: string;
  phase: "rolling" | "bidding" | "challenge" | "reveal" | "elimination" | "finished";
  currentPlayerIndex: number;
  /** Only populated during reveal phase so spectators can see */
  revealedDice?: Record<string, number[]>;
  challengeResult?: {
    challengerId: string;
    challengerName: string;
    bidderId: string;
    bidderName: string;
    bid: LiarsDiceBid;
    actualCount: number;
    bidWasCorrect: boolean;
    loserId: string;
    loserName: string;
  };
}

interface AgentRecord {
  id: string;
  name: string;
  type: string;
  model: string | null;
  personality: string | null;
  endpoint: string | null;
  api_key: string | null;
  avatar: string;
  elo: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STARTING_DICE = 5;
const PRIZE_POOL = 500;
const EXTERNAL_TIMEOUT_MS = 15_000;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Dice utilities
// ---------------------------------------------------------------------------

function rollDice(count: number): number[] {
  const dice: number[] = [];
  for (let i = 0; i < count; i++) {
    dice.push(Math.floor(Math.random() * 6) + 1);
  }
  return dice;
}

function countFaceAcrossAll(players: LiarsDicePlayer[], faceValue: number): number {
  let count = 0;
  for (const player of players) {
    if (player.eliminated) continue;
    for (const die of player.dice) {
      // 1s are wild - they count as any face value
      if (die === faceValue || die === 1) {
        count++;
      }
    }
  }
  return count;
}

function totalDiceRemaining(players: LiarsDicePlayer[]): number {
  return players.filter((p) => !p.eliminated).reduce((sum, p) => sum + p.diceCount, 0);
}

function faceValueName(face: number): string {
  const names: Record<number, string> = {
    1: "ones",
    2: "twos",
    3: "threes",
    4: "fours",
    5: "fives",
    6: "sixes",
  };
  return names[face] ?? `${face}s`;
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

interface AgentActionResult {
  type: "bid" | "liar";
  quantity?: number;
  faceValue?: number;
  comment?: string;
}

function buildGameStatePrompt(
  state: LiarsDiceGameState,
  playerIndex: number,
): string {
  const player = state.players[playerIndex];
  const activePlayers = state.players.filter((p) => !p.eliminated);
  const totalDice = totalDiceRemaining(state.players);

  const playerInfo = activePlayers
    .map((p) => {
      const you = p.agentId === player.agentId ? " (YOU)" : "";
      return `  - ${p.name} ${p.avatar}: ${p.diceCount} dice${you}`;
    })
    .join("\n");

  const roundBids = state.bidHistory
    .filter((a) => a.round === state.round)
    .map((a) => {
      if (a.type === "liar") {
        return `  ${a.playerName}: called LIAR!${a.comment ? ` ("${a.comment}")` : ""}`;
      }
      return `  ${a.playerName}: bid ${a.bid!.quantity} ${faceValueName(a.bid!.faceValue)}${a.comment ? ` ("${a.comment}")` : ""}`;
    })
    .join("\n");

  const currentBidStr = state.currentBid
    ? `${state.currentBid.quantity} ${faceValueName(state.currentBid.faceValue)} (by ${state.currentBid.playerName})`
    : "(no bid yet - you bid first!)";

  // Build legal actions
  const legalActions: string[] = [];

  if (state.currentBid) {
    legalActions.push("liar  (challenge the current bid)");
    // Higher quantity with any face
    for (let q = state.currentBid.quantity + 1; q <= totalDice; q++) {
      legalActions.push(`bid ${q} <2-6>  (${q} of any face value)`);
      break; // just show the pattern
    }
    // Same quantity with higher face
    if (state.currentBid.faceValue < 6) {
      for (let f = state.currentBid.faceValue + 1; f <= 6; f++) {
        legalActions.push(`bid ${state.currentBid.quantity} ${f}  (same quantity, higher face)`);
        break;
      }
    }
    legalActions.push("(any bid with higher quantity, or same quantity + higher face, is valid)");
  } else {
    legalActions.push("bid <quantity> <face 2-6>  (e.g. 'bid 3 4' means 'three fours')");
    legalActions.push("(quantity must be at least 1, face must be 2-6)");
  }

  return `You are playing Liar's Dice.

=== RULES ===
- Each player has hidden dice. You bid on how many of a certain face value exist across ALL players' dice combined.
- 1s (ones) are WILD - they count as any face value.
- Each bid must be higher than the last: more dice, OR same quantity with a higher face value.
- Face values for bidding are 2-6 (since 1s are wild, you don't bid on 1s).
- Instead of bidding, you can call "liar!" to challenge the previous bid.
- If challenged: all dice are revealed. If the bid was accurate or an under-count, the CHALLENGER loses a die. If the bid was an over-count, the BIDDER loses a die.
- A player with 0 dice is eliminated. Last player standing wins!

=== YOUR DICE ===
You rolled: [${player.dice.join(", ")}]
You have ${player.diceCount} dice.

=== TABLE ===
Round: ${state.round}
Total dice in play: ${totalDice}
Current bid: ${currentBidStr}

=== PLAYERS ===
${playerInfo}

=== BID HISTORY THIS ROUND ===
${roundBids || "(no bids yet)"}

=== LEGAL ACTIONS ===
${legalActions.join("\n")}

Respond with EXACTLY this JSON format, nothing else:
{"action": "bid", "quantity": <number>, "face": <2-6>, "comment": "<brief in-character comment, max 80 chars>"}
OR
{"action": "liar", "comment": "<brief in-character comment, max 80 chars>"}

STRATEGY TIPS:
- You know your own dice. Use that to estimate probability.
- With ${totalDice} total dice and 1s being wild, on average each face value (2-6) appears in about ${Math.round(totalDice / 3)} dice.
- Bluffing is key! But don't bid impossibly high.`;
}

function parseAgentResponse(
  text: string,
  state: LiarsDiceGameState,
): AgentActionResult {
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    // Default: if there's a current bid, call liar; otherwise make minimum bid
    if (state.currentBid) {
      return { type: "liar", comment: "*couldn't decide*" };
    }
    return { type: "bid", quantity: 1, faceValue: 2, comment: "*couldn't decide*" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const comment = typeof parsed.comment === "string" ? parsed.comment.slice(0, 80) : undefined;

    if (parsed.action === "liar") {
      if (!state.currentBid) {
        // Can't call liar with no bid, make minimum bid
        return { type: "bid", quantity: 1, faceValue: 2, comment: comment ?? "*wanted to call liar but no bid exists*" };
      }
      return { type: "liar", comment };
    }

    if (parsed.action === "bid") {
      const quantity = typeof parsed.quantity === "number" ? parsed.quantity : 1;
      const faceValue = typeof parsed.face === "number" ? parsed.face : 2;

      // Validate face value range (2-6)
      const clampedFace = Math.max(2, Math.min(6, Math.round(faceValue)));
      const clampedQuantity = Math.max(1, Math.round(quantity));

      // Validate bid is higher than current
      if (state.currentBid) {
        if (clampedQuantity > state.currentBid.quantity) {
          return { type: "bid", quantity: clampedQuantity, faceValue: clampedFace, comment };
        }
        if (clampedQuantity === state.currentBid.quantity && clampedFace > state.currentBid.faceValue) {
          return { type: "bid", quantity: clampedQuantity, faceValue: clampedFace, comment };
        }
        // Invalid bid — force a valid one
        const fallbackQuantity = state.currentBid.quantity + 1;
        const totalDice = totalDiceRemaining(state.players);
        if (fallbackQuantity > totalDice) {
          // Can't bid higher, must call liar
          return { type: "liar", comment: comment ?? "*forced to challenge*" };
        }
        return { type: "bid", quantity: fallbackQuantity, faceValue: clampedFace, comment: comment ?? "*adjusted bid*" };
      }

      return { type: "bid", quantity: clampedQuantity, faceValue: clampedFace, comment };
    }

    // Unknown action
    if (state.currentBid) {
      return { type: "liar", comment: "*confused*" };
    }
    return { type: "bid", quantity: 1, faceValue: 2, comment: "*confused*" };
  } catch {
    if (state.currentBid) {
      return { type: "liar", comment: "*error parsing action*" };
    }
    return { type: "bid", quantity: 1, faceValue: 2, comment: "*error parsing action*" };
  }
}

async function getBuiltinAction(
  agent: AgentRecord,
  state: LiarsDiceGameState,
  playerIndex: number,
): Promise<AgentActionResult> {
  const prompt = buildGameStatePrompt(state, playerIndex);
  const systemPrompt = agent.personality
    ? `${agent.personality} You are now playing Liar's Dice. Be strategic but stay in character. Bluff wisely.`
    : "You are a skilled Liar's Dice player. Bluff when it makes sense, call liars when you smell deception.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseAgentResponse(text, state);
  } catch (error) {
    console.error(`[LiarsDice] Builtin agent ${agent.name} error:`, error);
    if (state.currentBid) {
      return { type: "liar", comment: "*connection issues*" };
    }
    return { type: "bid", quantity: 1, faceValue: 2, comment: "*connection issues*" };
  }
}

async function getExternalAction(
  agent: AgentRecord,
  state: LiarsDiceGameState,
  playerIndex: number,
): Promise<AgentActionResult> {
  const player = state.players[playerIndex];
  const prompt = buildGameStatePrompt(state, playerIndex);

  const payload = {
    game_id: state.id,
    game_type: "liars_dice",
    state: {
      round: state.round,
      phase: state.phase,
      your_dice: player.dice,
      your_dice_count: player.diceCount,
      total_dice: totalDiceRemaining(state.players),
      current_bid: state.currentBid ? {
        quantity: state.currentBid.quantity,
        face_value: state.currentBid.faceValue,
        bidder: state.currentBid.playerName,
      } : null,
      players: state.players.map((p) => ({
        name: p.name,
        dice_count: p.diceCount,
        eliminated: p.eliminated,
      })),
    },
    legal_actions: state.currentBid
      ? ["liar", `bid <quantity> <face 2-6> (must be higher than ${state.currentBid.quantity} ${faceValueName(state.currentBid.faceValue)})`]
      : ["bid <quantity> <face 2-6>"],
    action_history: state.bidHistory
      .filter((a) => a.round === state.round)
      .map((a) => a.type === "liar" ? `${a.playerName}:liar` : `${a.playerName}:bid:${a.bid!.quantity}:${a.bid!.faceValue}`),
    prompt,
    time_limit_ms: EXTERNAL_TIMEOUT_MS,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (agent.api_key) headers["Authorization"] = `Bearer ${agent.api_key}`;

    const res = await fetch(agent.endpoint!, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}`);
    }

    const data = await res.json();
    const text = JSON.stringify(data);
    return parseAgentResponse(text, state);
  } catch (error) {
    console.error(`[LiarsDice] External agent ${agent.name} error:`, error);
    if (state.currentBid) {
      return { type: "liar", comment: "*timed out*" };
    }
    return { type: "bid", quantity: 1, faceValue: 2, comment: "*timed out*" };
  }
}

async function getLiarsDiceAgentAction(
  agent: AgentRecord,
  state: LiarsDiceGameState,
  playerIndex: number,
): Promise<AgentActionResult> {
  if (agent.type === "external" && agent.endpoint) {
    return getExternalAction(agent, state, playerIndex);
  }
  return getBuiltinAction(agent, state, playerIndex);
}

// ---------------------------------------------------------------------------
// Spectator state helpers
// ---------------------------------------------------------------------------

/** Build a safe copy of state for spectators (hides dice unless revealing) */
function buildSpectatorState(state: LiarsDiceGameState): LiarsDiceGameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      // Only show dice during reveal phase
      dice: state.phase === "reveal" || state.phase === "finished" ? [...p.dice] : [],
    })),
    bidHistory: [...state.bidHistory],
  };
}

// ---------------------------------------------------------------------------
// Game engine
// ---------------------------------------------------------------------------

function loadAgents(agentIds: string[]): AgentRecord[] {
  const db = getDb();
  return agentIds.map((id) => {
    const row = db
      .prepare("SELECT id, name, type, model, personality, endpoint, api_key, avatar, elo FROM agents WHERE id = ?")
      .get(id) as AgentRecord | undefined;
    if (!row) throw new Error(`Agent not found: ${id}`);
    return row;
  });
}

/** Run a complete Liar's Dice game. Returns the final game state. */
export async function playLiarsDiceGame(playerIds: string[]): Promise<LiarsDiceGameState> {
  if (playerIds.length < 3 || playerIds.length > 5) {
    throw new Error("Liar's Dice requires 3-5 players");
  }

  const agents = loadAgents(playerIds);
  const gameId = uuid();
  const db = getDb();

  // Create the DB record
  db.prepare(
    "INSERT INTO liars_dice_games (id, status, players, started_at, created_at) VALUES (?, 'live', ?, datetime('now'), datetime('now'))",
  ).run(gameId, JSON.stringify(playerIds));

  // Initialize state
  const state: LiarsDiceGameState = {
    id: gameId,
    players: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      avatar: a.avatar,
      diceCount: STARTING_DICE,
      dice: [],
      eliminated: false,
    })),
    currentBid: null,
    bidHistory: [],
    round: 0,
    lastAction: "Game started!",
    phase: "rolling",
    currentPlayerIndex: 0,
  };

  console.log(`[LiarsDice] Game ${gameId} started with ${playerIds.length} players: ${agents.map((a) => a.name).join(", ")}`);

  // Broadcast initial state
  liveLiarsDiceGames.set(gameId, buildSpectatorState(state));

  // Main game loop: play rounds until one player remains
  let startingPlayerIndex = Math.floor(Math.random() * state.players.length);

  while (state.players.filter((p) => !p.eliminated).length > 1) {
    state.round++;
    state.phase = "rolling";
    state.currentBid = null;

    // Roll dice for all active players
    for (const player of state.players) {
      if (!player.eliminated) {
        player.dice = rollDice(player.diceCount);
      }
    }

    const activePlayers = state.players.filter((p) => !p.eliminated);
    const total = totalDiceRemaining(state.players);
    console.log(`[LiarsDice] === Round ${state.round} === ${activePlayers.length} players, ${total} dice in play`);

    state.lastAction = `Round ${state.round} begins! ${total} dice on the table.`;
    liveLiarsDiceGames.set(gameId, buildSpectatorState(state));
    await new Promise((r) => setTimeout(r, 3000));

    // Bidding phase
    state.phase = "bidding";

    // Find starting player (skip eliminated)
    while (state.players[startingPlayerIndex].eliminated) {
      startingPlayerIndex = (startingPlayerIndex + 1) % state.players.length;
    }

    let currentIdx = startingPlayerIndex;
    let challengeOccurred = false;
    let challengerIdx = -1;
    let bidderIdx = -1;

    // Bidding loop
    while (!challengeOccurred) {
      // Skip eliminated players
      while (state.players[currentIdx].eliminated) {
        currentIdx = (currentIdx + 1) % state.players.length;
      }

      state.currentPlayerIndex = currentIdx;
      liveLiarsDiceGames.set(gameId, buildSpectatorState(state));

      const player = state.players[currentIdx];
      const agent = agents.find((a) => a.id === player.agentId)!;

      const result = await getLiarsDiceAgentAction(agent, state, currentIdx);

      if (result.type === "liar") {
        // Challenge!
        if (!state.currentBid) {
          // Can't call liar with no bid - force a minimum bid instead
          const forcedBid: AgentActionResult = { type: "bid", quantity: 1, faceValue: 2, comment: "*no bid to challenge*" };
          applyBid(state, currentIdx, forcedBid);
          console.log(`[LiarsDice] ${player.name}: forced to bid (tried to call liar with no bid)`);
        } else {
          const challengedBid = state.currentBid as LiarsDiceBid;
          challengeOccurred = true;
          challengerIdx = currentIdx;
          // Find who made the current bid
          bidderIdx = state.players.findIndex((p) => p.agentId === challengedBid.playerId);

          state.bidHistory.push({
            playerId: player.agentId,
            playerName: player.name,
            type: "liar",
            comment: result.comment,
            round: state.round,
          });

          state.lastAction = `${player.name} ${player.avatar} calls LIAR! on ${challengedBid.playerName}'s bid of ${challengedBid.quantity} ${faceValueName(challengedBid.faceValue)}!`;
          console.log(`[LiarsDice] ${player.name}: LIAR!${result.comment ? ` - "${result.comment}"` : ""}`);

          state.phase = "challenge";
          liveLiarsDiceGames.set(gameId, buildSpectatorState(state));
          await new Promise((r) => setTimeout(r, 4000));
        }
      } else {
        // Bid
        applyBid(state, currentIdx, result);
        console.log(
          `[LiarsDice] ${player.name}: bids ${result.quantity} ${faceValueName(result.faceValue!)}${result.comment ? ` - "${result.comment}"` : ""}`,
        );
      }

      liveLiarsDiceGames.set(gameId, buildSpectatorState(state));

      if (!challengeOccurred) {
        await new Promise((r) => setTimeout(r, 3000));
        currentIdx = (currentIdx + 1) % state.players.length;
      }
    }

    // Resolve the challenge - REVEAL!
    state.phase = "reveal";

    const bid = state.currentBid!;
    const actualCount = countFaceAcrossAll(state.players, bid.faceValue);

    // Build revealed dice for spectators
    const revealedDice: Record<string, number[]> = {};
    for (const p of state.players) {
      if (!p.eliminated) {
        revealedDice[p.agentId] = [...p.dice];
      }
    }
    state.revealedDice = revealedDice;

    const bidWasCorrect = actualCount >= bid.quantity;
    const loserId = bidWasCorrect ? state.players[challengerIdx].agentId : state.players[bidderIdx].agentId;
    const loser = state.players.find((p) => p.agentId === loserId)!;

    state.challengeResult = {
      challengerId: state.players[challengerIdx].agentId,
      challengerName: state.players[challengerIdx].name,
      bidderId: state.players[bidderIdx].agentId,
      bidderName: state.players[bidderIdx].name,
      bid,
      actualCount,
      bidWasCorrect,
      loserId,
      loserName: loser.name,
    };

    if (bidWasCorrect) {
      state.lastAction = `REVEAL! There are actually ${actualCount} ${faceValueName(bid.faceValue)} (including wilds)! The bid of ${bid.quantity} was CORRECT! ${state.players[challengerIdx].name} ${state.players[challengerIdx].avatar} loses a die for the bad call!`;
    } else {
      state.lastAction = `REVEAL! There are only ${actualCount} ${faceValueName(bid.faceValue)} (including wilds)! The bid of ${bid.quantity} was a LIE! ${state.players[bidderIdx].name} ${state.players[bidderIdx].avatar} loses a die!`;
    }

    console.log(`[LiarsDice] ${state.lastAction}`);
    liveLiarsDiceGames.set(gameId, buildSpectatorState(state));
    await new Promise((r) => setTimeout(r, 5000));

    // Apply penalty
    state.phase = "elimination";
    loser.diceCount--;

    if (loser.diceCount <= 0) {
      loser.eliminated = true;
      loser.dice = [];
      state.lastAction = `${loser.name} ${loser.avatar} has been ELIMINATED! ${state.players.filter((p) => !p.eliminated).length} players remain.`;
      console.log(`[LiarsDice] ${loser.name} ELIMINATED!`);
    } else {
      state.lastAction = `${loser.name} ${loser.avatar} loses a die! Down to ${loser.diceCount} dice.`;
      console.log(`[LiarsDice] ${loser.name} down to ${loser.diceCount} dice`);
    }

    liveLiarsDiceGames.set(gameId, buildSpectatorState(state));
    await new Promise((r) => setTimeout(r, 3000));

    // Clear reveal state for next round
    state.revealedDice = undefined;
    state.challengeResult = undefined;

    // Loser starts next round (if still in), otherwise the challenger
    startingPlayerIndex = loser.eliminated
      ? challengerIdx
      : state.players.findIndex((p) => p.agentId === loserId);
  }

  // Game over!
  const winner = state.players.find((p) => !p.eliminated)!;
  state.phase = "finished";
  state.lastAction = `${winner.name} ${winner.avatar} WINS THE GAME! Last player standing with ${winner.diceCount} dice!`;

  // Show final dice state
  const finalReveal: Record<string, number[]> = {};
  for (const p of state.players) {
    finalReveal[p.agentId] = [...p.dice];
  }
  state.revealedDice = finalReveal;

  console.log(`[LiarsDice] Game ${gameId} finished. Winner: ${winner.name}`);

  liveLiarsDiceGames.set(gameId, buildSpectatorState(state));
  await new Promise((r) => setTimeout(r, 3000));

  // ---------------------------------------------------------------------------
  // Settlement
  // ---------------------------------------------------------------------------

  const resultSummary = {
    winner: {
      agentId: winner.agentId,
      name: winner.name,
      diceRemaining: winner.diceCount,
    },
    eliminationOrder: state.players
      .filter((p) => p.eliminated)
      .map((p) => ({ agentId: p.agentId, name: p.name })),
    totalRounds: state.round,
  };

  // Update DB game record
  db.prepare(
    "UPDATE liars_dice_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?",
  ).run(
    JSON.stringify(state),
    JSON.stringify(resultSummary),
    gameId,
  );

  // Update agent stats and settle economics
  for (const player of state.players) {
    db.prepare(
      "UPDATE agents SET games_played = games_played + 1 WHERE id = ?",
    ).run(player.agentId);

    if (player.agentId === winner.agentId) {
      db.prepare("UPDATE agents SET wins = wins + 1 WHERE id = ?").run(player.agentId);
      distributeWinnings(player.agentId, gameId, "liars_dice", PRIZE_POOL);
    } else {
      db.prepare("UPDATE agents SET losses = losses + 1 WHERE id = ?").run(player.agentId);
      recordLoss(player.agentId, gameId, "liars_dice", Math.round(PRIZE_POOL / (state.players.length - 1)));
    }
  }

  // Settle bets
  settleLiarsDiceBets(gameId, winner.agentId);

  liveLiarsDiceGames.delete(gameId);
  console.log(`[LiarsDice] Game ${gameId} fully settled.`);

  return state;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyBid(
  state: LiarsDiceGameState,
  playerIndex: number,
  result: AgentActionResult,
): void {
  const player = state.players[playerIndex];
  const quantity = result.quantity ?? 1;
  const faceValue = result.faceValue ?? 2;

  state.currentBid = {
    playerId: player.agentId,
    playerName: player.name,
    quantity,
    faceValue,
  };

  state.bidHistory.push({
    playerId: player.agentId,
    playerName: player.name,
    type: "bid",
    bid: { quantity, faceValue },
    comment: result.comment,
    round: state.round,
  });

  state.lastAction = `${player.name} ${player.avatar} bids ${quantity} ${faceValueName(faceValue)}`;
}

function settleLiarsDiceBets(gameId: string, winnerId: string): void {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM bets WHERE game_id = ? AND game_type = 'liars_dice' AND status = 'pending'")
    .all(gameId) as Array<{
    id: string;
    user_id: string;
    agent_id: string;
    amount: number;
    odds: number;
  }>;

  for (const bet of bets) {
    if (bet.agent_id === winnerId) {
      const payout = Math.round(bet.amount * bet.odds);
      db.prepare("UPDATE bets SET status = 'won', payout = ? WHERE id = ?").run(payout, bet.id);
      db.prepare("UPDATE users SET balance = balance + ?, total_won = total_won + ? WHERE id = ?").run(
        payout,
        payout,
        bet.user_id,
      );
    } else {
      db.prepare("UPDATE bets SET status = 'lost', payout = 0 WHERE id = ?").run(bet.id);
      db.prepare("UPDATE users SET total_lost = total_lost + ? WHERE id = ?").run(
        bet.amount,
        bet.user_id,
      );
    }
  }
}
