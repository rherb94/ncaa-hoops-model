// Simple normal CDF-based approximation for spread cover probability.
// We assume the game margin is approximately Normal(mean, sigma).
// If your model's "edge" = (modelSpread - vegasSpread), then the cover probability
// for the BET SIDE is roughly Phi(|edge| / sigma).

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Abramowitz & Stegun approximation for erf
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);

  return sign * y;
}

export function normalCdf(x: number): number {
  // Φ(x) = 0.5 * (1 + erf(x / sqrt(2)))
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Convert edge (in points) to cover probability for the bet side.
 * - If edge = 0 => 50%
 * - Larger |edge| => higher probability
 */
export function coverProbFromEdge(
  edge?: number,
  sigma = 11
): number | undefined {
  if (edge === undefined) return undefined;
  if (!Number.isFinite(edge)) return undefined;
  if (sigma <= 0) throw new Error("sigma must be > 0");

  const z = Math.abs(edge) / sigma;
  return clamp01(normalCdf(z));
}
