// src/lib/grading.ts
// Juice-aware grading. A "unit" is the amount risked on each play, so a win
// at -110 returns +0.909 units, a win at +105 returns +1.05, a loss is -1 and
// a push is 0. Flat one-unit stakes throughout.

export const DEFAULT_PRICE = -110;

export type PickResult = "WIN" | "LOSS" | "PUSH" | "NO_PICK" | "PENDING";

/** Profit, in units, from winning one unit staked at American odds `price`. */
export function winProfit(price: number = DEFAULT_PRICE): number {
  if (!Number.isFinite(price) || price === 0) price = DEFAULT_PRICE;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

/** Units won or lost on a graded play; null when it isn't a settled play. */
export function unitsFor(result: PickResult, price: number = DEFAULT_PRICE): number | null {
  if (result === "WIN") return winProfit(price);
  if (result === "LOSS") return -1;
  if (result === "PUSH") return 0;
  return null;
}

/** Win rate needed to break even at a given price (52.4% at -110). */
export function breakEvenPct(price: number = DEFAULT_PRICE): number {
  const p = winProfit(price);
  return 1 / (1 + p);
}

/**
 * The price for the side we picked, from the line of record. Snapshots taken
 * before prices were stored have none, so those grade at the standard -110.
 */
export function pickPrice(
  side: "HOME" | "AWAY" | "NONE",
  opening?: { homePrice?: number | null; awayPrice?: number | null } | null
): { price: number; assumed: boolean } {
  const p = side === "HOME" ? opening?.homePrice : side === "AWAY" ? opening?.awayPrice : null;
  if (typeof p === "number" && Number.isFinite(p) && p !== 0) return { price: p, assumed: false };
  return { price: DEFAULT_PRICE, assumed: true };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
