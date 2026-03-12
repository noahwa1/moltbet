"use client";

import { useMemo } from "react";

interface ChessBoardProps {
  fen: string;
  lastMove?: { from: string; to: string } | null;
  size?: number;
}

const PIECE_UNICODE: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

export default function ChessBoard({ fen, size = 400 }: ChessBoardProps) {
  const board = useMemo(() => {
    const rows = fen.split(" ")[0].split("/");
    const grid: (string | null)[][] = [];

    for (const row of rows) {
      const gridRow: (string | null)[] = [];
      for (const char of row) {
        if (/\d/.test(char)) {
          for (let i = 0; i < parseInt(char); i++) gridRow.push(null);
        } else {
          gridRow.push(char);
        }
      }
      grid.push(gridRow);
    }
    return grid;
  }, [fen]);

  const squareSize = size / 8;

  return (
    <div
      className="relative rounded-lg overflow-hidden shadow-2xl border border-white/10"
      style={{ width: size, height: size }}
    >
      {board.map((row, r) =>
        row.map((piece, c) => {
          const isLight = (r + c) % 2 === 0;
          const file = String.fromCharCode(97 + c);
          const rank = 8 - r;

          return (
            <div
              key={`${r}-${c}`}
              className="absolute flex items-center justify-center transition-all duration-300"
              style={{
                width: squareSize,
                height: squareSize,
                left: c * squareSize,
                top: r * squareSize,
                backgroundColor: isLight ? "#B7C0D8" : "#6B7AA1",
              }}
            >
              {/* Coordinate labels */}
              {c === 0 && (
                <span
                  className="absolute top-0.5 left-1 text-[10px] font-bold opacity-40"
                  style={{ color: isLight ? "#6B7AA1" : "#B7C0D8" }}
                >
                  {rank}
                </span>
              )}
              {r === 7 && (
                <span
                  className="absolute bottom-0 right-1 text-[10px] font-bold opacity-40"
                  style={{ color: isLight ? "#6B7AA1" : "#B7C0D8" }}
                >
                  {file}
                </span>
              )}

              {/* Piece */}
              {piece && (
                <span
                  className="select-none transition-all duration-500 drop-shadow-lg"
                  style={{
                    fontSize: squareSize * 0.7,
                    lineHeight: 1,
                    filter:
                      piece === piece.toUpperCase()
                        ? "drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                        : "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                  }}
                >
                  {PIECE_UNICODE[piece]}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
