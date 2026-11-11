// src/lib/signal.ts
// Turns a model-vs-market edge into a signal. Pure and dependency-free so both
// server code and client components can import it.
//
//   NONE     |edge| < 3
//   LEAN     3 ≤ |edge| < 5                      → a play
//   STRONG   5 ≤ |edge| < 8                      → a play
//   CAUTION  |edge| ≥ 8, or the market spread is 20+ points and the edge
//            would otherwise be a play           → shown, NOT a play
//
// CAUTION exists because the two situations where the model disagrees most
// with the market are the ones where it is least trustworthy:
//   • A very large edge usually means the market knows something the ratings
//     don't (injury, suspension, roster change).
//   • On blowout lines the model is known to run short of the market — it
//     has every 20+ point favorite winning by fewer points than the line, so
//     it would "pick" the underdog in all of them.
// CAUTION games are never recorded as picks and never count toward the
// model's performance record.

export type ModelSignal = "NONE" | "LEAN" | "STRONG" | "CAUTION";

export const LEAN_EDGE = 3;
export const STRONG_EDGE = 5;
export const CAUTION_EDGE = 8;
export const BIG_SPREAD = 20;

export function computeSignal(edge?: number | null, marketSpread?: number | null): ModelSignal {
  if (edge === undefined || edge === null || !Number.isFinite(edge)) return "NONE";
  const a = Math.abs(edge);
  if (a < LEAN_EDGE) return "NONE";
  if (a >= CAUTION_EDGE) return "CAUTION";
  if (marketSpread != null && Math.abs(marketSpread) >= BIG_SPREAD) return "CAUTION";
  return a >= STRONG_EDGE ? "STRONG" : "LEAN";
}

/** True only for signals that are actual plays (tracked, graded, counted). */
export function isPlay(signal?: string | null): boolean {
  return signal === "LEAN" || signal === "STRONG";
}

/** Short explanation shown next to a CAUTION game; undefined otherwise. */
export function cautionNote(edge?: number | null, marketSpread?: number | null): string | undefined {
  if (computeSignal(edge, marketSpread) !== "CAUTION") return undefined;
  const bigSpread = marketSpread != null && Math.abs(marketSpread) >= BIG_SPREAD;
  const bigEdge = Math.abs(edge as number) >= CAUTION_EDGE;
  if (bigSpread) {
    return `Model is known to run short on ${BIG_SPREAD}+ point spreads — not a play, not tracked.`;
  }
  if (bigEdge) {
    return `Edge of ${CAUTION_EDGE}+ points usually means news the ratings don't have — check before trusting. Not a play, not tracked.`;
  }
  return undefined;
}
