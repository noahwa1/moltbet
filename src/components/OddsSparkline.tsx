"use client";

interface OddsSnapshot {
  moveNumber: number;
  white: number;
  black: number;
  evaluation: number;
  timestamp: number;
}

interface OddsSparklineProps {
  history: OddsSnapshot[];
  height?: number;
  width?: number;
}

export default function OddsSparkline({
  history,
  height = 120,
  width = 320,
}: OddsSparklineProps) {
  if (history.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-zinc-600 text-xs"
        style={{ height, width }}
      >
        Waiting for moves...
      </div>
    );
  }

  const padding = { top: 10, right: 10, bottom: 20, left: 10 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Normalize evaluation to 0-1 range (positive = white advantage)
  const evals = history.map((h) => h.evaluation);
  const maxAbsEval = Math.max(3, ...evals.map(Math.abs));

  const points = history.map((h, i) => {
    const x = padding.left + (i / (history.length - 1)) * chartW;
    // Map eval from [-maxAbsEval, maxAbsEval] to [chartH, 0] (higher = white better = top)
    const normalized = (h.evaluation + maxAbsEval) / (2 * maxAbsEval);
    const y = padding.top + (1 - normalized) * chartH;
    return { x, y, eval: h.evaluation, move: h.moveNumber };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  // Gradient fill below/above center
  const centerY = padding.top + chartH / 2;
  const fillPathWhite = `${linePath} L ${points[points.length - 1].x} ${centerY} L ${points[0].x} ${centerY} Z`;

  // Current eval for color
  const lastEval = evals[evals.length - 1];
  const lineColor =
    lastEval > 0.5 ? "#34d399" : lastEval < -0.5 ? "#f87171" : "#a1a1aa";
  const fillColor =
    lastEval > 0.5
      ? "rgba(52, 211, 153, 0.1)"
      : lastEval < -0.5
        ? "rgba(248, 113, 113, 0.1)"
        : "rgba(161, 161, 170, 0.05)";

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
          Live Odds Movement
        </h3>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-emerald-400">White</span>
          <span className="text-zinc-600">|</span>
          <span className="text-red-400">Black</span>
        </div>
      </div>

      <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
        {/* Center line (equal position) */}
        <line
          x1={padding.left}
          y1={centerY}
          x2={width - padding.right}
          y2={centerY}
          stroke="rgba(255,255,255,0.1)"
          strokeDasharray="4 4"
        />

        {/* Fill area */}
        <path d={fillPathWhite} fill={fillColor} />

        {/* Main line */}
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Current point (last) */}
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={4}
          fill={lineColor}
          className="animate-pulse"
        />

        {/* Labels */}
        <text x={padding.left} y={height - 2} fill="#71717a" fontSize={9} fontFamily="monospace">
          Move 1
        </text>
        <text
          x={width - padding.right}
          y={height - 2}
          fill="#71717a"
          fontSize={9}
          fontFamily="monospace"
          textAnchor="end"
        >
          Move {history[history.length - 1].moveNumber}
        </text>

        {/* Side labels */}
        <text x={padding.left} y={padding.top + 4} fill="#34d399" fontSize={8} fontFamily="monospace">
          +W
        </text>
        <text x={padding.left} y={height - padding.bottom - 2} fill="#f87171" fontSize={8} fontFamily="monospace">
          +B
        </text>
      </svg>
    </div>
  );
}
