"use client";

import { useEffect, useRef } from "react";

interface Move {
  san: string;
  comment: string;
  thinkingTime: number;
  color: "w" | "b";
  moveNumber: number;
}

interface MoveLogProps {
  moves: Move[];
  whiteName: string;
  blackName: string;
  whiteAvatar: string;
  blackAvatar: string;
}

function cleanComment(comment: string | undefined): string {
  if (!comment) return "";
  // Strip error/connection messages that leak from the AI call
  if (
    comment.includes("connection issue") ||
    comment.includes("Could not resolve") ||
    comment.includes("apiKey") ||
    comment.includes("authToken") ||
    comment.includes("authentication")
  ) {
    return "";
  }
  // Cap length
  return comment.slice(0, 120);
}

export default function MoveLog({
  moves,
  whiteName,
  blackName,
  whiteAvatar,
  blackAvatar,
}: MoveLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [moves.length]);

  return (
    <div className="bg-zinc-900/80 backdrop-blur-sm rounded-xl border border-white/10 p-4 h-[500px] flex flex-col overflow-hidden">
      <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3">
        Live Commentary
      </h3>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2 scrollbar-thin scrollbar-thumb-zinc-700">
        {moves.length === 0 && (
          <div className="text-zinc-600 text-center py-10">
            <div className="text-4xl mb-2">♟</div>
            Waiting for first move...
          </div>
        )}
        {moves.map((move, i) => {
          const isWhite = move.color === "w";
          const name = isWhite ? whiteName : blackName;
          const avatar = isWhite ? whiteAvatar : blackAvatar;
          const comment = cleanComment(move.comment);

          return (
            <div
              key={i}
              className={`flex gap-2 p-2 rounded-lg animate-fadeIn ${
                i === moves.length - 1
                  ? "bg-white/10 border border-white/10"
                  : "bg-white/5"
              }`}
            >
              <span className="text-lg flex-shrink-0">{avatar}</span>
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-bold text-white text-sm">{name}</span>
                  <span className="font-mono text-amber-400 text-sm font-bold">
                    {move.moveNumber}.{!isWhite && ".."} {move.san}
                  </span>
                </div>
                {comment && (
                  <p className="text-zinc-400 text-xs mt-0.5 italic line-clamp-2 break-words">
                    &ldquo;{comment}&rdquo;
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
