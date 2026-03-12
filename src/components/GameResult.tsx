"use client";

interface GameResultProps {
  result: string;
  whiteName: string;
  blackName: string;
  whiteAvatar: string;
  blackAvatar: string;
}

export default function GameResult({
  result,
  whiteName,
  blackName,
  whiteAvatar,
  blackAvatar,
}: GameResultProps) {
  const winner =
    result === "1-0"
      ? { name: whiteName, avatar: whiteAvatar }
      : result === "0-1"
        ? { name: blackName, avatar: blackAvatar }
        : null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center animate-fadeIn">
      <div className="bg-zinc-900 border border-white/20 rounded-2xl p-8 text-center max-w-md mx-4 shadow-2xl">
        {winner ? (
          <>
            <div className="text-6xl mb-4 animate-bounce">{winner.avatar}</div>
            <h2 className="text-3xl font-bold text-white mb-2">
              {winner.name} Wins!
            </h2>
            <p className="text-zinc-400">
              {result === "1-0" ? "White" : "Black"} wins by{" "}
              {result === "1-0" ? "checkmate" : "checkmate"}
            </p>
          </>
        ) : (
          <>
            <div className="text-6xl mb-4">🤝</div>
            <h2 className="text-3xl font-bold text-white mb-2">Draw!</h2>
            <p className="text-zinc-400">
              {whiteAvatar} {whiteName} and {blackAvatar} {blackName} split the
              point
            </p>
          </>
        )}
        <div className="mt-6 text-5xl font-mono font-bold text-amber-400">
          {result}
        </div>
      </div>
    </div>
  );
}
