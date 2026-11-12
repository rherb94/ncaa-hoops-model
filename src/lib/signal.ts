// src/lib/signal.ts
// Turns a model-vs-market edge into a signal. Pure and dependency-free so both
// server code and client components can import it.
//
//   NONE     |edge| < lean
//   LEAN     lean ≤ |edge| < strong                → a play
//   STRONG   strong ≤ |edge| < caution             → a play
//   CAUTION  |edge| ≥ caution, or a would-be play on a big spread
//                                                  → shown, NOT a play
// Thresholds differ by sport (see BASKETBALL_ / FOOTBALL_THRESHOLDS).
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

export type SignalThresholds = {
  lean: number;
  strong: number;
  /** Edge at or above which a game is CAUTION, not a play. */
  caution: number;
  /** Market spread at or above which a would-be play becomes CAUTION. */
  bigSpread: number;
};

// Basketball: set from last season's results.
export const BASKETBALL_THRESHOLDS: SignalThresholds = { lean: 3, strong: 5, caution: 8, bigSpread: 20 };

// Football: provisional. Final margins vary about 25% more than in college
// basketball, so the edge bands are scaled up, and 20+ point spreads are
// routine, so the blowout guard starts at 28. Revisit with a backtest.
export const FOOTBALL_THRESHOLDS: SignalThresholds = { lean: 4, strong: 6.5, caution: 10, bigSpread: 28 };

export function thresholdsFor(league?: string | null): SignalThresholds {
  return league === "cfb" ? FOOTBALL_THRESHOLDS : BASKETBALL_THRESHOLDS;
}

// Kept for callers that only deal with basketball.
export const LEAN_EDGE = BASKETBALL_THRESHOLDS.lean;
export const STRONG_EDGE = BASKETBALL_THRESHOLDS.strong;
export const CAUTION_EDGE = BASKETBALL_THRESHOLDS.caution;
export const BIG_SPREAD = BASKETBALL_THRESHOLDS.bigSpread;

export function computeSignal(
  edge?: number | null,
  marketSpread?: number | null,
  league?: string | null
): ModelSignal {
  if (edge === undefined || edge === null || !Number.isFinite(edge)) return "NONE";
  const t = thresholdsFor(league);
  const a = Math.abs(edge);
  if (a < t.lean) return "NONE";
  if (a >= t.caution) return "CAUTION";
  if (marketSpread != null && Math.abs(marketSpread) >= t.bigSpread) return "CAUTION";
  return a >= t.strong ? "STRONG" : "LEAN";
}

/** True only for signals that are actual plays (tracked, graded, counted). */
export function isPlay(signal?: string | null): boolean {
  return signal === "LEAN" || signal === "STRONG";
}

/** Short explanation shown next to a CAUTION game; undefined otherwise. */
export function cautionNote(
  edge?: number | null,
  marketSpread?: number | null,
  league?: string | null
): string | undefined {
  if (computeSignal(edge, marketSpread, league) !== "CAUTION") return undefined;
  const t = thresholdsFor(league);
  if (marketSpread != null && Math.abs(marketSpread) >= t.bigSpread) {
    return `Model is unreliable on ${t.bigSpread}+ point spreads. Not a play, not tracked.`;
  }
  return `An edge of ${t.caution}+ points usually means news the ratings don't have. Not a play, not tracked.`;
}
