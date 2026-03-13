import { getDb } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Card {
  rank: string; // '2'-'10','J','Q','K','A'
  suit: "hearts" | "diamonds" | "clubs" | "spades";
}

export interface PokerPlayer {
  agentId: string;
  name: string;
  avatar: string;
  chips: number;
  holeCards: Card[];
  currentBet: number;
  folded: boolean;
  allIn: boolean;
}

export interface PokerAction {
  playerId: string;
  action: "fold" | "check" | "call" | "raise" | "all-in";
  amount?: number;
  comment?: string;
  phase: string;
}

export interface PokerGameState {
  id: string;
  players: PokerPlayer[];
  communityCards: Card[];
  pot: number;
  currentBet: number;
  phase: "preflop" | "flop" | "turn" | "river" | "showdown" | "finished";
  actions: PokerAction[];
  dealerIndex: number;
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

const SUITS: Card["suit"][] = ["hearts", "diamonds", "clubs", "spades"];
const RANKS: string[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "J", "Q", "K", "A",
];

const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const EXTERNAL_TIMEOUT_MS = 15_000;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Hand evaluation
// ---------------------------------------------------------------------------

const RANK_VALUE: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

/** Hand ranking tiers (higher = better). */
const HAND_RANK = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
} as const;

const HAND_RANK_NAMES: Record<number, string> = {
  0: "High Card",
  1: "One Pair",
  2: "Two Pair",
  3: "Three of a Kind",
  4: "Straight",
  5: "Flush",
  6: "Full House",
  7: "Four of a Kind",
  8: "Straight Flush",
  9: "Royal Flush",
};

interface HandEvaluation {
  rank: number;       // HAND_RANK value
  tiebreakers: number[]; // descending priority kickers
  name: string;
  bestCards: Card[];
}

/** Evaluate the best 5-card hand from up to 7 cards. */
export function evaluateHand(cards: Card[]): HandEvaluation {
  const combos = combinations(cards, 5);
  let best: HandEvaluation | null = null;
  for (const combo of combos) {
    const ev = evaluate5(combo);
    if (!best || compareEvaluations(ev, best) > 0) {
      best = ev;
    }
  }
  return best!;
}

function evaluate5(cards: Card[]): HandEvaluation {
  const values = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);

  // Check straight (including A-low: A,2,3,4,5)
  let isStraight = false;
  let straightHigh = 0;
  const uniqueVals = [...new Set(values)].sort((a, b) => b - a);
  if (uniqueVals.length === 5) {
    if (uniqueVals[0] - uniqueVals[4] === 4) {
      isStraight = true;
      straightHigh = uniqueVals[0];
    }
    // Ace-low straight: A,5,4,3,2
    if (
      uniqueVals[0] === 14 &&
      uniqueVals[1] === 5 &&
      uniqueVals[2] === 4 &&
      uniqueVals[3] === 3 &&
      uniqueVals[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5; // 5-high straight
    }
  }

  // Count occurrences
  const counts: Record<number, number> = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([val, cnt]) => ({ val: Number(val), cnt }))
    .sort((a, b) => b.cnt - a.cnt || b.val - a.val);

  // Royal Flush
  if (isFlush && isStraight && straightHigh === 14) {
    return { rank: HAND_RANK.ROYAL_FLUSH, tiebreakers: [14], name: "Royal Flush", bestCards: cards };
  }

  // Straight Flush
  if (isFlush && isStraight) {
    return { rank: HAND_RANK.STRAIGHT_FLUSH, tiebreakers: [straightHigh], name: "Straight Flush", bestCards: cards };
  }

  // Four of a Kind
  if (groups[0].cnt === 4) {
    const quad = groups[0].val;
    const kicker = groups[1].val;
    return { rank: HAND_RANK.FOUR_OF_A_KIND, tiebreakers: [quad, kicker], name: "Four of a Kind", bestCards: cards };
  }

  // Full House
  if (groups[0].cnt === 3 && groups[1].cnt === 2) {
    return { rank: HAND_RANK.FULL_HOUSE, tiebreakers: [groups[0].val, groups[1].val], name: "Full House", bestCards: cards };
  }

  // Flush
  if (isFlush) {
    return { rank: HAND_RANK.FLUSH, tiebreakers: values, name: "Flush", bestCards: cards };
  }

  // Straight
  if (isStraight) {
    return { rank: HAND_RANK.STRAIGHT, tiebreakers: [straightHigh], name: "Straight", bestCards: cards };
  }

  // Three of a Kind
  if (groups[0].cnt === 3) {
    const kickers = groups.filter((g) => g.cnt === 1).map((g) => g.val);
    return { rank: HAND_RANK.THREE_OF_A_KIND, tiebreakers: [groups[0].val, ...kickers], name: "Three of a Kind", bestCards: cards };
  }

  // Two Pair
  if (groups[0].cnt === 2 && groups[1].cnt === 2) {
    const highPair = Math.max(groups[0].val, groups[1].val);
    const lowPair = Math.min(groups[0].val, groups[1].val);
    const kicker = groups[2].val;
    return { rank: HAND_RANK.TWO_PAIR, tiebreakers: [highPair, lowPair, kicker], name: "Two Pair", bestCards: cards };
  }

  // One Pair
  if (groups[0].cnt === 2) {
    const kickers = groups.filter((g) => g.cnt === 1).map((g) => g.val);
    return { rank: HAND_RANK.ONE_PAIR, tiebreakers: [groups[0].val, ...kickers], name: "One Pair", bestCards: cards };
  }

  // High Card
  return { rank: HAND_RANK.HIGH_CARD, tiebreakers: values, name: "High Card", bestCards: cards };
}

/** Positive if a > b, negative if a < b, 0 if tied. */
function compareEvaluations(a: HandEvaluation, b: HandEvaluation): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const av = a.tiebreakers[i] ?? 0;
    const bv = b.tiebreakers[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Generate all k-combinations of arr. */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const results: T[][] = [];
  const [first, ...rest] = arr;
  // combos that include first
  for (const combo of combinations(rest, k - 1)) {
    results.push([first, ...combo]);
  }
  // combos that don't include first
  for (const combo of combinations(rest, k)) {
    results.push(combo);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardToString(c: Card): string {
  const suitSymbol: Record<string, string> = {
    hearts: "\u2665",
    diamonds: "\u2666",
    clubs: "\u2663",
    spades: "\u2660",
  };
  return `${c.rank}${suitSymbol[c.suit]}`;
}

function cardsToString(cards: Card[]): string {
  return cards.map(cardToString).join(" ");
}

// ---------------------------------------------------------------------------
// Agent interaction
// ---------------------------------------------------------------------------

interface AgentActionResult {
  action: "fold" | "check" | "call" | "raise" | "all-in";
  amount?: number;
  comment?: string;
}

function buildLegalActions(
  player: PokerPlayer,
  currentBet: number,
  minRaise: number,
): string[] {
  const actions: string[] = [];
  const toCall = currentBet - player.currentBet;

  actions.push("fold");

  if (toCall === 0) {
    actions.push("check");
  } else if (toCall > 0 && toCall < player.chips) {
    actions.push(`call ${toCall}`);
  }

  if (player.chips > toCall) {
    const raiseMin = Math.min(toCall + minRaise, player.chips);
    const raiseMax = player.chips;
    if (raiseMin === raiseMax) {
      actions.push(`raise ${raiseMin} (all-in)`);
    } else {
      actions.push(`raise ${raiseMin}-${raiseMax}`);
    }
  }

  actions.push(`all-in ${player.chips}`);

  return actions;
}

function buildGameStatePrompt(
  state: PokerGameState,
  playerIndex: number,
  legalActions: string[],
): string {
  const player = state.players[playerIndex];
  const opponents = state.players
    .filter((_, i) => i !== playerIndex)
    .map((p) => {
      const status = p.folded ? "(folded)" : p.allIn ? "(all-in)" : "";
      return `  - ${p.name} ${p.avatar}: ${p.chips} chips, bet ${p.currentBet} this round ${status}`;
    })
    .join("\n");

  const recentActions = state.actions
    .slice(-10)
    .map((a) => {
      const pName = state.players.find((p) => p.agentId === a.playerId)?.name ?? a.playerId;
      const amt = a.amount !== undefined ? ` $${a.amount}` : "";
      return `  ${pName}: ${a.action}${amt}${a.comment ? ` ("${a.comment}")` : ""}`;
    })
    .join("\n");

  return `You are playing Texas Hold'em Poker.

=== YOUR INFO ===
Name: ${player.name}
Chips: ${player.chips}
Your hole cards: ${cardsToString(player.holeCards)}
Your current bet this round: ${player.currentBet}

=== TABLE ===
Phase: ${state.phase}
Community cards: ${state.communityCards.length > 0 ? cardsToString(state.communityCards) : "(none yet)"}
Pot: ${state.pot}
Current bet to match: ${state.currentBet}

=== OPPONENTS ===
${opponents}

=== RECENT ACTIONS ===
${recentActions || "(none yet)"}

=== LEGAL ACTIONS ===
${legalActions.join("\n")}

Respond with EXACTLY this JSON format, nothing else:
{"action": "<fold|check|call|raise|all-in>", "amount": <number or null>, "comment": "<brief in-character comment, max 80 chars>"}

RULES:
- "fold": give up the hand
- "check": pass (only if no bet to match)
- "call": match the current bet
- "raise": increase the bet (specify amount as total bet, not the increment)
- "all-in": bet all your remaining chips
- amount is required for "raise" and "all-in"`;
}

function parseAgentResponse(
  text: string,
  player: PokerPlayer,
  currentBet: number,
  minRaise: number,
): AgentActionResult {
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { action: "fold", comment: "*couldn't decide*" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const action = parsed.action as string;
    const comment = typeof parsed.comment === "string" ? parsed.comment.slice(0, 80) : undefined;
    const amount = typeof parsed.amount === "number" ? parsed.amount : undefined;
    const toCall = currentBet - player.currentBet;

    switch (action) {
      case "fold":
        return { action: "fold", comment };

      case "check":
        if (toCall === 0) {
          return { action: "check", comment };
        }
        // Can't check when there's a bet; default to fold
        return { action: "fold", comment: comment ?? "*wanted to check but had to fold*" };

      case "call": {
        if (toCall <= 0) {
          return { action: "check", comment };
        }
        const callAmt = Math.min(toCall, player.chips);
        if (callAmt >= player.chips) {
          return { action: "all-in", amount: player.chips, comment };
        }
        return { action: "call", amount: callAmt, comment };
      }

      case "raise": {
        let raiseTotal = amount ?? (currentBet + minRaise);
        raiseTotal = Math.max(raiseTotal, currentBet + minRaise);
        raiseTotal = Math.min(raiseTotal, player.chips + player.currentBet);
        const raiseChips = raiseTotal - player.currentBet;
        if (raiseChips >= player.chips) {
          return { action: "all-in", amount: player.chips, comment };
        }
        return { action: "raise", amount: raiseChips, comment };
      }

      case "all-in":
        return { action: "all-in", amount: player.chips, comment };

      default:
        return { action: "fold", comment: "*confused*" };
    }
  } catch {
    return { action: "fold", comment: "*error parsing action*" };
  }
}

export async function getPokerAgentAction(
  agent: AgentRecord,
  state: PokerGameState,
  playerIndex: number,
): Promise<AgentActionResult> {
  const player = state.players[playerIndex];
  const minRaise = BIG_BLIND;
  const legalActions = buildLegalActions(player, state.currentBet, minRaise);
  const prompt = buildGameStatePrompt(state, playerIndex, legalActions);

  if (agent.type === "external" && agent.endpoint) {
    return getExternalPokerAction(agent, state, playerIndex, prompt, legalActions);
  }
  return getBuiltinPokerAction(agent, prompt, player, state.currentBet, minRaise);
}

async function getBuiltinPokerAction(
  agent: AgentRecord,
  prompt: string,
  player: PokerPlayer,
  currentBet: number,
  minRaise: number,
): Promise<AgentActionResult> {
  const systemPrompt = agent.personality
    ? `${agent.personality} You are now playing poker. Be strategic but stay in character.`
    : "You are a skilled poker player. Play smart.";

  try {
    const response = await anthropic.messages.create({
      model: agent.model ?? "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseAgentResponse(text, player, currentBet, minRaise);
  } catch (error) {
    console.error(`[Poker] Builtin agent ${agent.name} error:`, error);
    // Default to calling or checking
    const toCall = currentBet - player.currentBet;
    if (toCall === 0) return { action: "check", comment: "*connection issues*" };
    if (toCall <= player.chips) return { action: "call", amount: Math.min(toCall, player.chips), comment: "*connection issues*" };
    return { action: "fold", comment: "*connection issues*" };
  }
}

async function getExternalPokerAction(
  agent: AgentRecord,
  state: PokerGameState,
  playerIndex: number,
  prompt: string,
  legalActions: string[],
): Promise<AgentActionResult> {
  const player = state.players[playerIndex];
  const minRaise = BIG_BLIND;

  const payload = {
    game_id: state.id,
    game_type: "poker",
    state: {
      phase: state.phase,
      community_cards: state.communityCards,
      pot: state.pot,
      current_bet: state.currentBet,
      your_hole_cards: player.holeCards,
      your_chips: player.chips,
      your_current_bet: player.currentBet,
      players: state.players.map((p) => ({
        name: p.name,
        chips: p.chips,
        current_bet: p.currentBet,
        folded: p.folded,
        all_in: p.allIn,
      })),
    },
    legal_actions: legalActions,
    action_history: state.actions.map(
      (a) => `${a.playerId}:${a.action}${a.amount !== undefined ? `:${a.amount}` : ""}`,
    ),
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
    // External agents return {action, amount?, comment?}
    const text = JSON.stringify(data);
    return parseAgentResponse(text, player, state.currentBet, minRaise);
  } catch (error) {
    console.error(`[Poker] External agent ${agent.name} error:`, error);
    const toCall = state.currentBet - player.currentBet;
    if (toCall === 0) return { action: "check", comment: "*timed out*" };
    if (toCall <= player.chips) return { action: "call", amount: Math.min(toCall, player.chips), comment: "*timed out*" };
    return { action: "fold", comment: "*timed out*" };
  }
}

// ---------------------------------------------------------------------------
// Game engine
// ---------------------------------------------------------------------------

function loadAgents(agentIds: string[]): AgentRecord[] {
  const db = getDb();
  return agentIds.map((id) => {
    const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRecord | undefined;
    if (!row) throw new Error(`Agent not found: ${id}`);
    return row;
  });
}

/** Run a complete poker hand. Returns the final game state. */
export async function playPokerGame(playerAgentIds: string[]): Promise<PokerGameState> {
  if (playerAgentIds.length < 2 || playerAgentIds.length > 6) {
    throw new Error("Poker requires 2-6 players");
  }

  const agents = loadAgents(playerAgentIds);
  const gameId = uuid();
  const db = getDb();

  // Create the DB record
  db.prepare(
    "INSERT INTO poker_games (id, status, players, started_at) VALUES (?, 'live', ?, datetime('now'))",
  ).run(gameId, JSON.stringify(playerAgentIds));

  // Initialize state
  const state: PokerGameState = {
    id: gameId,
    players: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      avatar: a.avatar,
      chips: STARTING_CHIPS,
      holeCards: [],
      currentBet: 0,
      folded: false,
      allIn: false,
    })),
    communityCards: [],
    pot: 0,
    currentBet: 0,
    phase: "preflop",
    actions: [],
    dealerIndex: Math.floor(Math.random() * playerAgentIds.length),
  };

  const deck = shuffleDeck(createDeck());
  let deckPos = 0;

  function deal(count: number): Card[] {
    const cards = deck.slice(deckPos, deckPos + count);
    deckPos += count;
    return cards;
  }

  // Deal hole cards
  for (const player of state.players) {
    player.holeCards = deal(2);
  }

  // Post blinds
  const numPlayers = state.players.length;
  const sbIndex = (state.dealerIndex + 1) % numPlayers;
  const bbIndex = (state.dealerIndex + 2) % numPlayers;

  postBlind(state, sbIndex, SMALL_BLIND);
  postBlind(state, bbIndex, BIG_BLIND);
  state.currentBet = BIG_BLIND;

  console.log(`[Poker] Game ${gameId} started with ${numPlayers} players. Dealer: ${state.players[state.dealerIndex].name}`);

  // Pre-flop: action starts left of big blind
  const preflopStart = (bbIndex + 1) % numPlayers;
  await runBettingRound(state, agents, preflopStart);

  if (countActivePlayers(state) <= 1) {
    return finishGame(state, agents, db);
  }

  // Flop
  state.phase = "flop";
  deal(1); // burn
  state.communityCards.push(...deal(3));
  resetBetsForNewRound(state);
  console.log(`[Poker] Flop: ${cardsToString(state.communityCards)}`);

  const postFlopStart = findFirstActiveAfterDealer(state);
  await runBettingRound(state, agents, postFlopStart);

  if (countActivePlayers(state) <= 1) {
    return finishGame(state, agents, db);
  }

  // Turn
  state.phase = "turn";
  deal(1); // burn
  state.communityCards.push(...deal(1));
  resetBetsForNewRound(state);
  console.log(`[Poker] Turn: ${cardsToString(state.communityCards)}`);

  await runBettingRound(state, agents, postFlopStart);

  if (countActivePlayers(state) <= 1) {
    return finishGame(state, agents, db);
  }

  // River
  state.phase = "river";
  deal(1); // burn
  state.communityCards.push(...deal(1));
  resetBetsForNewRound(state);
  console.log(`[Poker] River: ${cardsToString(state.communityCards)}`);

  await runBettingRound(state, agents, postFlopStart);

  // Showdown
  return finishGame(state, agents, db);
}

function postBlind(state: PokerGameState, playerIndex: number, amount: number): void {
  const player = state.players[playerIndex];
  const actual = Math.min(amount, player.chips);
  player.chips -= actual;
  player.currentBet += actual;
  state.pot += actual;
  if (player.chips === 0) player.allIn = true;

  state.actions.push({
    playerId: player.agentId,
    action: actual === player.chips + actual ? "all-in" : "call",
    amount: actual,
    comment: actual === SMALL_BLIND ? "small blind" : "big blind",
    phase: state.phase,
  });
}

function resetBetsForNewRound(state: PokerGameState): void {
  for (const p of state.players) {
    p.currentBet = 0;
  }
  state.currentBet = 0;
}

function countActivePlayers(state: PokerGameState): number {
  return state.players.filter((p) => !p.folded).length;
}

function countActionablePlayers(state: PokerGameState): number {
  return state.players.filter((p) => !p.folded && !p.allIn).length;
}

function findFirstActiveAfterDealer(state: PokerGameState): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.dealerIndex + i) % n;
    if (!state.players[idx].folded && !state.players[idx].allIn) {
      return idx;
    }
  }
  return (state.dealerIndex + 1) % n;
}

async function runBettingRound(
  state: PokerGameState,
  agents: AgentRecord[],
  startIndex: number,
): Promise<void> {
  const n = state.players.length;
  // Track who has acted at the current bet level to know when the round ends.
  const actedAtCurrentBet = new Set<string>();
  let lastRaiserIndex = -1;
  let currentIndex = startIndex;
  let consecutiveActions = 0;
  const maxActions = n * 4; // safety limit

  while (consecutiveActions < maxActions) {
    const player = state.players[currentIndex];

    // Skip folded, all-in, or seated-out players
    if (player.folded || player.allIn) {
      currentIndex = (currentIndex + 1) % n;
      consecutiveActions++;
      continue;
    }

    // If everyone who can act has acted at the current bet level, round is over
    if (actedAtCurrentBet.has(player.agentId) && currentIndex !== lastRaiserIndex) {
      // Check if all actionable players have acted
      const actionable = state.players.filter((p) => !p.folded && !p.allIn);
      const allActed = actionable.every((p) => actedAtCurrentBet.has(p.agentId));
      if (allActed) break;
    }
    if (actedAtCurrentBet.has(player.agentId) && lastRaiserIndex === -1) {
      break;
    }

    // Only one player can act? Round over.
    if (countActionablePlayers(state) <= 1 && countActivePlayers(state) > 1) {
      // Everyone else is all-in or folded, and the remaining player has matched
      const toCall = state.currentBet - player.currentBet;
      if (toCall <= 0) break;
    }
    if (countActivePlayers(state) <= 1) break;

    const agent = agents.find((a) => a.id === player.agentId)!;
    const result = await getPokerAgentAction(agent, state, currentIndex);

    applyAction(state, currentIndex, result);

    console.log(
      `[Poker] ${player.name}: ${result.action}${result.amount ? ` $${result.amount}` : ""}${result.comment ? ` - "${result.comment}"` : ""}`,
    );

    if (result.action === "raise" || result.action === "all-in") {
      // A raise resets who needs to act
      actedAtCurrentBet.clear();
      actedAtCurrentBet.add(player.agentId);
      lastRaiserIndex = currentIndex;
    } else {
      actedAtCurrentBet.add(player.agentId);
    }

    if (countActivePlayers(state) <= 1) break;

    currentIndex = (currentIndex + 1) % n;
    consecutiveActions++;
  }
}

function applyAction(
  state: PokerGameState,
  playerIndex: number,
  result: AgentActionResult,
): void {
  const player = state.players[playerIndex];

  switch (result.action) {
    case "fold":
      player.folded = true;
      break;

    case "check":
      // No chips change
      break;

    case "call": {
      const toCall = Math.min(state.currentBet - player.currentBet, player.chips);
      player.chips -= toCall;
      player.currentBet += toCall;
      state.pot += toCall;
      if (player.chips === 0) player.allIn = true;
      break;
    }

    case "raise": {
      const amount = result.amount ?? BIG_BLIND;
      const actual = Math.min(amount, player.chips);
      player.chips -= actual;
      player.currentBet += actual;
      state.pot += actual;
      state.currentBet = Math.max(state.currentBet, player.currentBet);
      if (player.chips === 0) player.allIn = true;
      break;
    }

    case "all-in": {
      const allInAmount = player.chips;
      state.pot += allInAmount;
      player.currentBet += allInAmount;
      player.chips = 0;
      player.allIn = true;
      state.currentBet = Math.max(state.currentBet, player.currentBet);
      break;
    }
  }

  state.actions.push({
    playerId: player.agentId,
    action: result.action,
    amount: result.amount,
    comment: result.comment,
    phase: state.phase,
  });
}

// ---------------------------------------------------------------------------
// Winner determination and game conclusion
// ---------------------------------------------------------------------------

interface PotWinner {
  agentId: string;
  handName: string;
  winnings: number;
}

function determineWinners(state: PokerGameState): PotWinner[] {
  const activePlayers = state.players.filter((p) => !p.folded);

  // Single player remaining (everyone else folded)
  if (activePlayers.length === 1) {
    return [{
      agentId: activePlayers[0].agentId,
      handName: "Last player standing",
      winnings: state.pot,
    }];
  }

  // Evaluate hands
  const evaluations = activePlayers.map((player) => {
    const allCards = [...player.holeCards, ...state.communityCards];
    const ev = evaluateHand(allCards);
    return { player, evaluation: ev };
  });

  // Sort by hand strength (best first)
  evaluations.sort((a, b) => compareEvaluations(b.evaluation, a.evaluation));

  // Handle side pots for all-in situations
  // Simple approach: split pot among tied winners, otherwise give to best hand
  const bestEval = evaluations[0].evaluation;
  const winners = evaluations.filter(
    (e) => compareEvaluations(e.evaluation, bestEval) === 0,
  );

  const share = Math.floor(state.pot / winners.length);
  const remainder = state.pot - share * winners.length;

  return winners.map((w, i) => ({
    agentId: w.player.agentId,
    handName: w.evaluation.name,
    winnings: share + (i === 0 ? remainder : 0), // first winner gets remainder
  }));
}

function finishGame(
  state: PokerGameState,
  agents: AgentRecord[],
  db: ReturnType<typeof getDb>,
): PokerGameState {
  state.phase = "showdown";

  const winners = determineWinners(state);

  // Award chips
  for (const w of winners) {
    const player = state.players.find((p) => p.agentId === w.agentId)!;
    player.chips += w.winnings;
    console.log(`[Poker] Winner: ${player.name} with ${w.handName} - wins $${w.winnings}`);
  }

  state.phase = "finished";

  // Build result summary
  const resultSummary = {
    winners: winners.map((w) => ({
      agentId: w.agentId,
      name: state.players.find((p) => p.agentId === w.agentId)?.name,
      hand: w.handName,
      winnings: w.winnings,
    })),
    finalChips: state.players.map((p) => ({
      agentId: p.agentId,
      name: p.name,
      chips: p.chips,
    })),
  };

  // Update DB
  db.prepare(
    "UPDATE poker_games SET status = 'finished', state = ?, rounds = ?, result = ?, finished_at = datetime('now') WHERE id = ?",
  ).run(
    JSON.stringify(state),
    JSON.stringify(state.actions),
    JSON.stringify(resultSummary),
    state.id,
  );

  // Update agent stats
  const winnerIds = new Set(winners.map((w) => w.agentId));
  for (const player of state.players) {
    db.prepare(
      "UPDATE agents SET games_played = games_played + 1 WHERE id = ?",
    ).run(player.agentId);

    if (winnerIds.has(player.agentId)) {
      db.prepare("UPDATE agents SET wins = wins + 1 WHERE id = ?").run(player.agentId);
      const w = winners.find((win) => win.agentId === player.agentId)!;
      db.prepare("UPDATE agents SET earnings = earnings + ? WHERE id = ?").run(
        w.winnings,
        player.agentId,
      );

      // Record earnings
      db.prepare(
        "INSERT INTO agent_earnings (id, agent_id, game_id, game_type, amount, result) VALUES (?, ?, ?, 'poker', ?, 'win')",
      ).run(uuid(), player.agentId, state.id, w.winnings);
    } else {
      db.prepare("UPDATE agents SET losses = losses + 1 WHERE id = ?").run(player.agentId);
      const lost = STARTING_CHIPS - player.chips;
      if (lost > 0) {
        db.prepare(
          "INSERT INTO agent_earnings (id, agent_id, game_id, game_type, amount, result) VALUES (?, ?, ?, 'poker', ?, 'loss')",
        ).run(uuid(), player.agentId, state.id, -lost);
      }
    }
  }

  // Settle poker bets
  settlePokerBets(state.id, winnerIds);

  console.log(`[Poker] Game ${state.id} finished.`);

  return state;
}

function settlePokerBets(gameId: string, winnerIds: Set<string>): void {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM bets WHERE game_id = ? AND game_type = 'poker' AND status = 'pending'")
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
