import { getDb } from "@/lib/db";
import { distributeWinnings, recordLoss } from "@/lib/economics";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";

// In-memory live state for spectating
const liveAuctionGames = new Map<string, AuctionGameState>();

export function getLiveAuctionGame(id: string): AuctionGameState | undefined {
  return liveAuctionGames.get(id);
}

export function listLiveAuctionGames(): AuctionGameState[] {
  return Array.from(liveAuctionGames.values());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuctionItem {
  name: string;
  description: string;
  trueValue: number;
  hintLow: number;
  hintHigh: number;
}

export interface AuctionPlayer {
  agentId: string;
  name: string;
  avatar: string;
  budget: number;
  profit: number;
  itemsWon: Array<{ name: string; bid: number; trueValue: number; profit: number }>;
  passed: boolean;
}

export interface BidAction {
  playerId: string;
  playerName: string;
  action: "bid" | "pass";
  amount?: number;
  comment?: string;
  round: number;
}

export interface AuctionGameState {
  id: string;
  players: AuctionPlayer[];
  currentItem: AuctionItem | null;
  currentBid: number;
  currentBidder: string | null;
  currentBidderName: string | null;
  round: number;
  totalRounds: number;
  bidHistory: BidAction[];
  phase: "bidding" | "sold" | "reveal" | "finished";
  revealedValue: number | null;
  items: AuctionItem[];
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

const STARTING_BUDGET = 1000;
const TOTAL_ROUNDS = 5;
const MIN_BID_INCREMENT = 10;
const PRIZE_POOL = 500;
const EXTERNAL_TIMEOUT_MS = 15_000;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Auction items pool
// ---------------------------------------------------------------------------

const ITEM_POOL: Array<{ name: string; description: string }> = [
  {
    name: "Mystery Box from a Bankrupt Wizard's Estate",
    description: "A weathered oak box that hums faintly. The previous owner vanished under mysterious circumstances. Could contain ancient artifacts... or just moth-eaten robes.",
  },
  {
    name: "Slightly Used Time Machine (warranty voided)",
    description: "A brass contraption covered in dials and levers. The manual is missing pages 3 through infinity. Smells vaguely of the future.",
  },
  {
    name: "A Map to Buried Treasure (accuracy not guaranteed)",
    description: "Hand-drawn on what appears to be a fast-food napkin. Features an X, several skull-and-crossbones, and what might be a coffee stain or an island.",
  },
  {
    name: "Enchanted Rubber Duck",
    description: "Quacks in iambic pentameter. Glows softly when submerged in water. Previous owner claims it predicted three stock market crashes.",
  },
  {
    name: "The Last Known Copy of 'How to Win at Auctions'",
    description: "Ironic, isn't it? The spine is cracked, suggesting heavy use. Several pages are dog-eared. The final chapter is titled 'Just Stop Bidding.'",
  },
  {
    name: "Invisible Sword of Moderate Sharpness",
    description: "You can't see it, but the auctioneer assures you it's there. The velvet case has a suspiciously sword-shaped indentation. Handle with unseen care.",
  },
  {
    name: "Perpetual Motion Machine (batteries not included)",
    description: "Claimed to run forever. Currently not running. The inventor's notes say 'just give it a push.' Made entirely of recycled clock parts.",
  },
  {
    name: "A Jar of Genuine Dragon's Breath",
    description: "The jar is warm to the touch and occasionally rattles. Label reads: 'Collected at great personal risk. Do not open indoors. Or outdoors.'",
  },
  {
    name: "Self-Playing Chess Set (refuses to lose)",
    description: "The pieces move on their own and get visibly upset when you make bad moves. The king piece has been known to storm off the board entirely.",
  },
  {
    name: "Crystal Ball (resolution: 480p)",
    description: "Shows the future, but blurry. You can make out shapes and colors. Comes with a 30-day free trial of CrystalBall Premium for HD visions.",
  },
  {
    name: "Haunted Painting of a Very Polite Ghost",
    description: "The ghost in the painting occasionally waves. Leaves apologetic sticky notes if it accidentally startles you. Great conversationalist.",
  },
  {
    name: "Bottomless Bag of Holding (slight leak)",
    description: "Holds an infinite amount of stuff, but small items occasionally fall out the bottom. The manufacturer recalls have been... extensive.",
  },
  {
    name: "Ancient Philosopher's Stone (chipped)",
    description: "Turns lead into gold. Mostly. Sometimes it turns lead into slightly nicer lead. The chip happened during a 'rigorous testing phase.'",
  },
  {
    name: "Cloak of Partial Invisibility",
    description: "Makes you invisible from the waist down. Perfect for formal events where you don't want people to see your shoes. Dry clean only.",
  },
  {
    name: "A Compass That Points to What You Need Most",
    description: "Currently pointing at the snack table. Previous owner reported it consistently pointed toward therapy. Needle is slightly bent.",
  },
  {
    name: "Boots of Slightly Above Average Speed",
    description: "Won't make you the fastest, but you'll definitely beat your uncle in a foot race. Comfortable arch support. Available in brown.",
  },
  {
    name: "Universal Translator (67% accuracy)",
    description: "Translates most languages, most of the time. Occasionally substitutes words with 'banana' for unknown reasons. Software update pending.",
  },
  {
    name: "Wand of Mild Inconvenience",
    description: "Point it at someone and their shoelace unties. Or their phone goes to 1% battery. Nothing dangerous, just deeply annoying. Very petty. Very satisfying.",
  },
];

function generateItem(): AuctionItem {
  const template = ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)];
  const trueValue = Math.floor(Math.random() * 451) + 50; // 50-500
  const variance = Math.round(trueValue * 0.3);
  const hintLow = Math.max(10, trueValue - variance);
  const hintHigh = trueValue + variance;

  return {
    name: template.name,
    description: template.description,
    trueValue,
    hintLow,
    hintHigh,
  };
}

function generateUniqueItems(count: number): AuctionItem[] {
  const usedIndices = new Set<number>();
  const items: AuctionItem[] = [];

  while (items.length < count) {
    let idx: number;
    do {
      idx = Math.floor(Math.random() * ITEM_POOL.length);
    } while (usedIndices.has(idx) && usedIndices.size < ITEM_POOL.length);
    usedIndices.add(idx);

    const template = ITEM_POOL[idx];
    const trueValue = Math.floor(Math.random() * 451) + 50;
    const variance = Math.round(trueValue * 0.3);
    const hintLow = Math.max(10, trueValue - variance);
    const hintHigh = trueValue + variance;

    items.push({
      name: template.name,
      description: template.description,
      trueValue,
      hintLow,
      hintHigh,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

interface AgentBidResult {
  action: "bid" | "pass";
  amount?: number;
  comment?: string;
}

function buildAuctionPrompt(
  state: AuctionGameState,
  playerIndex: number,
): string {
  const player = state.players[playerIndex];
  const item = state.currentItem!;

  const playerScores = state.players
    .map((p) => {
      const status = p.agentId === player.agentId ? "(you)" : "";
      const itemCount = p.itemsWon.length;
      return `  - ${p.name} ${p.avatar}: budget ${p.budget}, profit ${p.profit}, items won: ${itemCount} ${status}`;
    })
    .join("\n");

  const recentBids = state.bidHistory
    .filter((b) => b.round === state.round)
    .slice(-10)
    .map((b) => {
      const amt = b.amount !== undefined ? ` $${b.amount}` : "";
      return `  ${b.playerName}: ${b.action}${amt}${b.comment ? ` ("${b.comment}")` : ""}`;
    })
    .join("\n");

  const currentBidInfo = state.currentBid > 0
    ? `Current highest bid: $${state.currentBid} by ${state.currentBidderName}`
    : "No bids yet (minimum starting bid: $10)";

  const minBid = state.currentBid > 0 ? state.currentBid + MIN_BID_INCREMENT : 10;

  return `You are playing Auction Wars - a competitive bidding game.

=== CURRENT ITEM (Round ${state.round} of ${state.totalRounds}) ===
Item: ${item.name}
Description: ${item.description}
Estimated value range: $${item.hintLow} - $${item.hintHigh}

=== BIDDING STATUS ===
${currentBidInfo}

=== YOUR INFO ===
Name: ${player.name}
Remaining budget: $${player.budget}
Your total profit so far: $${player.profit}

=== ALL PLAYERS ===
${playerScores}

=== RECENT BIDS THIS ROUND ===
${recentBids || "(none yet)"}

=== RULES ===
- The item has a hidden true value within (but not necessarily centered in) the hint range
- If you win the bid, your profit = true_value - your_bid (can be negative if you overpay!)
- Each bid must be at least $${minBid} (current bid + $${MIN_BID_INCREMENT} increment)
- You cannot bid more than your remaining budget ($${player.budget})
- Bidding continues until all players pass or only one bidder remains
- After ${state.totalRounds} rounds, the player with the highest total profit wins

=== LEGAL ACTIONS ===
${player.budget >= minBid ? `bid <amount> (where amount is between $${minBid} and $${player.budget})` : "(you cannot afford to bid)"}
pass (stop bidding on this item)

Respond with EXACTLY this JSON format, nothing else:
{"action": "<bid|pass>", "amount": <number or null>, "comment": "<brief in-character comment, max 80 chars>"}

STRATEGY TIPS:
- Bidding above the hint range is risky — you might overpay
- Sometimes it's better to pass and save budget for later rounds
- Watch what others are spending — if they're running low, later items will be cheaper`;
}

function parseAuctionResponse(
  text: string,
  player: AuctionPlayer,
  currentBid: number,
): AgentBidResult {
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { action: "pass", comment: "*couldn't decide*" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const action = parsed.action as string;
    const comment = typeof parsed.comment === "string" ? parsed.comment.slice(0, 80) : undefined;
    const amount = typeof parsed.amount === "number" ? Math.floor(parsed.amount) : undefined;
    const minBid = currentBid > 0 ? currentBid + MIN_BID_INCREMENT : 10;

    if (action === "pass") {
      return { action: "pass", comment };
    }

    if (action === "bid" && amount !== undefined) {
      if (amount < minBid) {
        return { action: "pass", comment: comment ?? "*bid too low, passing*" };
      }
      if (amount > player.budget) {
        return { action: "pass", comment: comment ?? "*can't afford it*" };
      }
      return { action: "bid", amount, comment };
    }

    return { action: "pass", comment: comment ?? "*confused*" };
  } catch {
    return { action: "pass", comment: "*error parsing action*" };
  }
}

async function getBuiltinAuctionAction(
  agent: AgentRecord,
  prompt: string,
  player: AuctionPlayer,
  currentBid: number,
): Promise<AgentBidResult> {
  const systemPrompt = agent.personality
    ? `${agent.personality} You are now playing an auction game. Be strategic but stay in character.`
    : "You are a savvy auction bidder. Play smart and try to get good deals.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseAuctionResponse(text, player, currentBid);
  } catch (error) {
    console.error(`[Auction] Builtin agent ${agent.name} error:`, error);
    return { action: "pass", comment: "*connection issues*" };
  }
}

async function getExternalAuctionAction(
  agent: AgentRecord,
  state: AuctionGameState,
  playerIndex: number,
  prompt: string,
): Promise<AgentBidResult> {
  const player = state.players[playerIndex];

  const payload = {
    game_id: state.id,
    game_type: "auction",
    state: {
      phase: state.phase,
      round: state.round,
      total_rounds: state.totalRounds,
      current_item: state.currentItem
        ? {
            name: state.currentItem.name,
            description: state.currentItem.description,
            hint_low: state.currentItem.hintLow,
            hint_high: state.currentItem.hintHigh,
          }
        : null,
      current_bid: state.currentBid,
      current_bidder: state.currentBidder,
      your_budget: player.budget,
      your_profit: player.profit,
      players: state.players.map((p) => ({
        name: p.name,
        budget: p.budget,
        profit: p.profit,
        items_won: p.itemsWon.length,
        passed: p.passed,
      })),
    },
    legal_actions: ["bid", "pass"],
    action_history: state.bidHistory
      .filter((b) => b.round === state.round)
      .map((a) => `${a.playerName}:${a.action}${a.amount !== undefined ? `:${a.amount}` : ""}`),
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
    return parseAuctionResponse(text, player, state.currentBid);
  } catch (error) {
    console.error(`[Auction] External agent ${agent.name} error:`, error);
    return { action: "pass", comment: "*timed out*" };
  }
}

export async function getAuctionAgentAction(
  agent: AgentRecord,
  state: AuctionGameState,
  playerIndex: number,
): Promise<AgentBidResult> {
  const player = state.players[playerIndex];
  const prompt = buildAuctionPrompt(state, playerIndex);

  if (agent.type === "external" && agent.endpoint) {
    return getExternalAuctionAction(agent, state, playerIndex, prompt);
  }
  return getBuiltinAuctionAction(agent, prompt, player, state.currentBid);
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

function broadcastState(state: AuctionGameState): void {
  liveAuctionGames.set(state.id, {
    ...state,
    players: state.players.map((p) => ({ ...p, itemsWon: [...p.itemsWon] })),
    bidHistory: [...state.bidHistory],
    currentItem: state.currentItem ? { ...state.currentItem } : null,
    items: state.items.map((i) => ({ ...i })),
  });
}

/** Run a complete auction game. Returns the final game state. */
export async function playAuctionGame(playerIds: string[]): Promise<AuctionGameState> {
  if (playerIds.length < 3 || playerIds.length > 5) {
    throw new Error("Auction requires 3-5 players");
  }

  const agents = loadAgents(playerIds);
  const gameId = uuid();
  const db = getDb();

  // Create auction_games table if needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS auction_games (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      players TEXT NOT NULL DEFAULT '[]',
      state TEXT DEFAULT '{}',
      result TEXT,
      scheduled_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create the DB record
  db.prepare(
    "INSERT INTO auction_games (id, status, players, started_at) VALUES (?, 'live', ?, datetime('now'))",
  ).run(gameId, JSON.stringify(playerIds));

  // Generate unique items for all rounds
  const items = generateUniqueItems(TOTAL_ROUNDS);

  // Initialize state
  const state: AuctionGameState = {
    id: gameId,
    players: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      avatar: a.avatar,
      budget: STARTING_BUDGET,
      profit: 0,
      itemsWon: [],
      passed: false,
    })),
    currentItem: null,
    currentBid: 0,
    currentBidder: null,
    currentBidderName: null,
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    bidHistory: [],
    phase: "bidding",
    revealedValue: null,
    items,
  };

  console.log(`[Auction] Game ${gameId} started with ${playerIds.length} players.`);

  // Play each round
  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    state.round = round;
    state.currentItem = items[round - 1];
    state.currentBid = 0;
    state.currentBidder = null;
    state.currentBidderName = null;
    state.revealedValue = null;
    state.phase = "bidding";

    // Reset passed status for all players
    for (const p of state.players) {
      p.passed = false;
    }

    console.log(`[Auction] Round ${round}: "${state.currentItem.name}" (true value: $${state.currentItem.trueValue})`);

    broadcastState(state);

    // Bidding loop
    let consecutivePasses = 0;
    let turnIndex = (round - 1) % state.players.length; // rotate starting player
    const maxTurns = state.players.length * 20; // safety limit
    let totalTurns = 0;

    while (totalTurns < maxTurns) {
      const player = state.players[turnIndex];

      // Skip players who have passed
      if (player.passed) {
        turnIndex = (turnIndex + 1) % state.players.length;
        totalTurns++;

        // Check if all players have passed
        const activeBidders = state.players.filter((p) => !p.passed);
        if (activeBidders.length === 0) break;
        if (activeBidders.length === 1 && state.currentBidder) break;
        continue;
      }

      // Check if only one active bidder remains and they hold the current bid
      const activeBidders = state.players.filter((p) => !p.passed);
      if (activeBidders.length === 1 && state.currentBidder === activeBidders[0].agentId) {
        break;
      }

      // Check if player can afford minimum bid
      const minBid = state.currentBid > 0 ? state.currentBid + MIN_BID_INCREMENT : 10;
      if (player.budget < minBid) {
        player.passed = true;
        state.bidHistory.push({
          playerId: player.agentId,
          playerName: player.name,
          action: "pass",
          comment: "Can't afford to bid",
          round,
        });
        broadcastState(state);
        turnIndex = (turnIndex + 1) % state.players.length;
        totalTurns++;
        continue;
      }

      // Get agent action
      const agent = agents.find((a) => a.id === player.agentId)!;
      const result = await getAuctionAgentAction(agent, state, state.players.indexOf(player));

      // Apply action
      if (result.action === "bid" && result.amount !== undefined) {
        state.currentBid = result.amount;
        state.currentBidder = player.agentId;
        state.currentBidderName = player.name;
        consecutivePasses = 0;

        state.bidHistory.push({
          playerId: player.agentId,
          playerName: player.name,
          action: "bid",
          amount: result.amount,
          comment: result.comment,
          round,
        });

        console.log(
          `[Auction] ${player.name}: bid $${result.amount}${result.comment ? ` - "${result.comment}"` : ""}`,
        );
      } else {
        player.passed = true;
        consecutivePasses++;

        state.bidHistory.push({
          playerId: player.agentId,
          playerName: player.name,
          action: "pass",
          comment: result.comment,
          round,
        });

        console.log(
          `[Auction] ${player.name}: pass${result.comment ? ` - "${result.comment}"` : ""}`,
        );
      }

      broadcastState(state);

      // 2s delay between bids for spectators
      await new Promise((r) => setTimeout(r, 2000));

      // Check end conditions
      const remaining = state.players.filter((p) => !p.passed);
      if (remaining.length === 0) break;
      if (remaining.length === 1 && state.currentBidder) break;

      turnIndex = (turnIndex + 1) % state.players.length;
      totalTurns++;
    }

    // Resolve round
    if (state.currentBidder) {
      state.phase = "sold";
      broadcastState(state);
      await new Promise((r) => setTimeout(r, 2000));

      // Reveal true value
      state.phase = "reveal";
      state.revealedValue = state.currentItem.trueValue;
      broadcastState(state);

      const winner = state.players.find((p) => p.agentId === state.currentBidder)!;
      const itemProfit = state.currentItem.trueValue - state.currentBid;

      winner.budget -= state.currentBid;
      winner.profit += itemProfit;
      winner.itemsWon.push({
        name: state.currentItem.name,
        bid: state.currentBid,
        trueValue: state.currentItem.trueValue,
        profit: itemProfit,
      });

      const verdict = itemProfit > 0 ? "STEAL" : itemProfit < 0 ? "OVERPAID" : "EVEN";
      console.log(
        `[Auction] SOLD to ${winner.name} for $${state.currentBid}! True value: $${state.currentItem.trueValue} (${verdict}: ${itemProfit > 0 ? "+" : ""}$${itemProfit})`,
      );

      broadcastState(state);

      // 4s delay for dramatic reveal
      await new Promise((r) => setTimeout(r, 4000));
    } else {
      // No one bid - item goes unsold
      state.phase = "reveal";
      state.revealedValue = state.currentItem.trueValue;
      broadcastState(state);

      console.log(
        `[Auction] No bids! Item unsold. True value was $${state.currentItem.trueValue}`,
      );

      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  // Game finished
  state.phase = "finished";
  broadcastState(state);

  // Determine winner (highest profit)
  const sortedPlayers = [...state.players].sort((a, b) => b.profit - a.profit);
  const gameWinner = sortedPlayers[0];

  console.log(`[Auction] Game finished! Winner: ${gameWinner.name} with profit $${gameWinner.profit}`);

  // Build result summary
  const resultSummary = {
    winner: {
      agentId: gameWinner.agentId,
      name: gameWinner.name,
      profit: gameWinner.profit,
      itemsWon: gameWinner.itemsWon,
    },
    standings: sortedPlayers.map((p, i) => ({
      rank: i + 1,
      agentId: p.agentId,
      name: p.name,
      profit: p.profit,
      budgetRemaining: p.budget,
      itemsWon: p.itemsWon,
    })),
  };

  // Update DB
  db.prepare(
    "UPDATE auction_games SET status = 'finished', state = ?, result = ?, finished_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(state), JSON.stringify(resultSummary), state.id);

  // Update agent stats and settle economics
  const winnerIds = new Set([gameWinner.agentId]);

  for (const player of state.players) {
    db.prepare(
      "UPDATE agents SET games_played = games_played + 1 WHERE id = ?",
    ).run(player.agentId);

    if (winnerIds.has(player.agentId)) {
      db.prepare("UPDATE agents SET wins = wins + 1 WHERE id = ?").run(player.agentId);
      distributeWinnings(player.agentId, state.id, "auction", PRIZE_POOL);
    } else {
      db.prepare("UPDATE agents SET losses = losses + 1 WHERE id = ?").run(player.agentId);
      const lossAmount = player.profit < 0 ? Math.abs(player.profit) : 0;
      if (lossAmount > 0) {
        recordLoss(player.agentId, state.id, "auction", lossAmount);
      }
    }
  }

  // Settle auction bets
  settleAuctionBets(state.id, winnerIds);

  console.log(`[Auction] Game ${state.id} finished.`);

  liveAuctionGames.delete(gameId);

  return state;
}

// ---------------------------------------------------------------------------
// Bet settlement
// ---------------------------------------------------------------------------

function settleAuctionBets(gameId: string, winnerIds: Set<string>): void {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM bets WHERE game_id = ? AND game_type = 'auction' AND status = 'pending'")
    .all(gameId) as Array<{
    id: string;
    user_id: string;
    agent_id: string;
    amount: number;
    odds: number;
  }>;

  for (const bet of bets) {
    if (winnerIds.has(bet.agent_id)) {
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
