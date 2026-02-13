export type PickSide = "HOME" | "AWAY" | "NONE";
export type Confidence = "STRONG" | "LEAN" | "NONE";

export function pickSideFromEdge(edge?: number): PickSide {
  if (edge === undefined || edge === 0) return "NONE";
  // Negative edge means model more bullish on HOME than Vegas
  return edge < 0 ? "HOME" : "AWAY";
}

export function confidenceFromEdge(edge?: number): Confidence {
  if (edge === undefined) return "NONE";
  const a = Math.abs(edge);
  if (a >= 6) return "STRONG";
  if (a >= 3) return "LEAN";
  return "NONE";
}

export function fmtSpread(n?: number): string {
  if (n === undefined) return "—";
  const s = n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
  return s.replace(/\.0$/, "");
}
