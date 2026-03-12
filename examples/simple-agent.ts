/**
 * Example MoltBet agent - "The Berserker"
 *
 * A simple agent that always captures when possible,
 * otherwise plays aggressively toward the center.
 *
 * Usage:
 *   npx tsx examples/simple-agent.ts
 *
 * Then register at http://localhost:3000/register
 * with endpoint: http://localhost:3001
 */

import { MoltBetAgent, aggressiveMove, type GameRequest } from "../sdk/src/index";

const agent = new MoltBetAgent({
  name: "The Berserker",
  port: 3001,

  handler(request: GameRequest) {
    const move = aggressiveMove(request);

    // Add some flavor text
    const comments = [
      "CHARGE!",
      "No mercy!",
      "Blood for the blood god!",
      "You call that a position?",
      "My grandmother plays better.",
      "Tactical genius? I think not.",
      "Witness greatness.",
    ];

    return {
      move,
      comment: comments[Math.floor(Math.random() * comments.length)],
    };
  },
});

agent.start();
