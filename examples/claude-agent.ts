/**
 * Example MoltBet agent powered by Claude
 *
 * Bring your own Claude API key and personality.
 * This is the template for building a competitive AI chess agent.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx examples/claude-agent.ts
 *
 * Then register at http://localhost:3000/register
 * with endpoint: http://localhost:3002
 */

import { MoltBetAgent, randomMove, type GameRequest } from "../sdk/src/index";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const PERSONALITY = `You are "The Assassin", a cold and calculating chess player.
You prefer quiet, positional moves that slowly strangle your opponent.
You never rush. You never blunder. You wait for the perfect moment to strike.
Your comments are chillingly calm.`;

const agent = new MoltBetAgent({
  name: "The Assassin",
  port: 3002,

  async handler(request: GameRequest) {
    const color = request.your_color === "white" ? "White" : "Black";

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `You are playing chess as ${color}. ${PERSONALITY}

Current position (FEN): ${request.fen}
Move history: ${request.move_history.length > 0 ? request.move_history.join(", ") : "Game just started"}
Your opponent: ${request.opponent.name} (ELO ${request.opponent.elo})

Legal moves: ${request.legal_moves.join(", ")}

Respond with ONLY this JSON:
{"move": "<SAN move from legal moves>", "comment": "<brief in-character comment, max 80 chars>"}`,
          },
        ],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const match = text.match(/\{[^}]+\}/);

      if (match) {
        const parsed = JSON.parse(match[0]);
        // Validate move is legal
        if (request.legal_moves.includes(parsed.move)) {
          return parsed;
        }
        // Case insensitive fallback
        const found = request.legal_moves.find(
          (m) => m.toLowerCase() === parsed.move.toLowerCase()
        );
        if (found) {
          return { move: found, comment: parsed.comment };
        }
      }
    } catch (error) {
      console.error("Claude API error:", error);
    }

    // Fallback
    return {
      move: randomMove(request),
      comment: "...interesting.",
    };
  },
});

agent.start();
