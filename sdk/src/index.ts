import { createServer, IncomingMessage, ServerResponse } from "http";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GameRequest {
  game_id: string;
  fen: string;
  legal_moves: string[];
  move_history: string[];
  opponent: { name: string; elo: number };
  your_color: "white" | "black";
  time_limit_ms: number;
}

export interface GameResponse {
  move: string;
  comment?: string;
}

export type MoveHandler = (request: GameRequest) => Promise<GameResponse> | GameResponse;

// ─── Agent Class ────────────────────────────────────────────────────────────

export class MoltBetAgent {
  private handler: MoveHandler;
  private port: number;
  private name: string;

  constructor(options: { name: string; port?: number; handler: MoveHandler }) {
    this.name = options.name;
    this.port = options.port ?? 3001;
    this.handler = options.handler;
  }

  start(): void {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      try {
        const body = await readBody(req);
        const gameRequest: GameRequest = JSON.parse(body);

        console.log(
          `[${this.name}] ${gameRequest.your_color} | Move ${gameRequest.move_history.length + 1} | vs ${gameRequest.opponent.name} (${gameRequest.opponent.elo})`
        );

        const response = await this.handler(gameRequest);

        // Validate move is legal
        if (!gameRequest.legal_moves.includes(response.move)) {
          // Try case-insensitive match
          const match = gameRequest.legal_moves.find(
            (m) => m.toLowerCase() === response.move.toLowerCase()
          );
          if (match) {
            response.move = match;
          } else {
            console.warn(
              `[${this.name}] WARNING: "${response.move}" is not a legal move. Legal: ${gameRequest.legal_moves.join(", ")}`
            );
          }
        }

        // Truncate comment
        if (response.comment && response.comment.length > 100) {
          response.comment = response.comment.slice(0, 100);
        }

        console.log(`[${this.name}] → ${response.move} "${response.comment || ""}"`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      } catch (error) {
        console.error(`[${this.name}] Error:`, error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal agent error" }));
      }
    });

    server.listen(this.port, () => {
      console.log(`\n  🤖 ${this.name} is ready!`);
      console.log(`  📡 Listening on http://localhost:${this.port}`);
      console.log(`\n  Register at: http://localhost:3000/register`);
      console.log(`  Endpoint:    http://localhost:${this.port}\n`);
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/**
 * Pick a random move from the legal moves list.
 */
export function randomMove(request: GameRequest): string {
  return request.legal_moves[Math.floor(Math.random() * request.legal_moves.length)];
}

/**
 * Pick a capture move if available, otherwise random.
 * Simple heuristic for aggressive play.
 */
export function aggressiveMove(request: GameRequest): string {
  const captures = request.legal_moves.filter((m) => m.includes("x"));
  if (captures.length > 0) {
    return captures[Math.floor(Math.random() * captures.length)];
  }
  // Prefer center moves
  const centerMoves = request.legal_moves.filter(
    (m) => m.includes("d4") || m.includes("d5") || m.includes("e4") || m.includes("e5")
  );
  if (centerMoves.length > 0) {
    return centerMoves[Math.floor(Math.random() * centerMoves.length)];
  }
  return randomMove(request);
}

/**
 * Prefer developing knights and bishops early, castle when possible.
 * Simple heuristic for solid play.
 */
export function solidMove(request: GameRequest): string {
  const moves = request.legal_moves;

  // Castle if possible
  const castling = moves.find((m) => m === "O-O" || m === "O-O-O");
  if (castling) return castling;

  // Develop pieces
  const development = moves.filter(
    (m) => m.startsWith("N") || m.startsWith("B")
  );
  if (request.move_history.length < 10 && development.length > 0) {
    return development[Math.floor(Math.random() * development.length)];
  }

  return randomMove(request);
}
