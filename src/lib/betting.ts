export type AmericanOdds = number; // e.g. -110, +120

export function americanToDecimal(odds: AmericanOdds): number {
  if (odds === 0) throw new Error("American odds cannot be 0");
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

export function decimalToAmerican(decimal: number): AmericanOdds {
  if (decimal <= 1) throw new Error("Decimal odds must be > 1");
  const profit = decimal - 1;

  // If profit >= 1, american is positive
  if (profit >= 1) return Math.round(profit * 100);

  // Otherwise negative
  return -Math.round(100 / profit);
}

export function americanToImpliedProb(odds: AmericanOdds): number {
  if (odds === 0) throw new Error("American odds cannot be 0");
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Remove vig for a 2-outcome market from implied probabilities.
 * Input: pA, pB are implied probabilities (with vig included).
 * Output: fair probabilities that sum to 1.
 */
export function removeVigTwoWay(
  pA: number,
  pB: number
): { fairA: number; fairB: number } {
  const sum = pA + pB;
  if (sum <= 0) throw new Error("Invalid probabilities");
  return { fairA: pA / sum, fairB: pB / sum };
}

/**
 * Expected Value for a bet given:
 * - your estimated win probability p
 * - american odds
 *
 * Returns EV as a fraction of stake, e.g. 0.05 = +5% EV.
 */
export function expectedValue(p: number, odds: AmericanOdds): number {
  const prob = clamp01(p);
  const dec = americanToDecimal(odds);
  const profitPerUnit = dec - 1;

  // EV = p * profit - (1-p) * 1
  return prob * profitPerUnit - (1 - prob);
}

/**
 * Kelly fraction (full Kelly). Returns 0..1+ (we’ll clamp in UI usually)
 * b = profit per unit (decimal - 1)
 * f* = (p*b - q) / b
 */
export function kellyFraction(p: number, odds: AmericanOdds): number {
  const prob = clamp01(p);
  const dec = americanToDecimal(odds);
  const b = dec - 1;
  const q = 1 - prob;

  const f = (prob * b - q) / b;
  return f;
}

/**
 * Convenience: half-Kelly bet fraction, clamped to [0, maxFraction]
 */
export function halfKellyClamped(
  p: number,
  odds: AmericanOdds,
  maxFraction = 0.05
): number {
  const f = kellyFraction(p, odds) / 2;
  return Math.max(0, Math.min(maxFraction, f));
}

/**
 * Format helpers
 */
export function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function fmtMoney(x: number): string {
  return x.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
