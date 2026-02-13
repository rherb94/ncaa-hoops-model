import type { BookKey, MarketLines, OddsGame } from "./types";

function median(nums: number[]): number | undefined {
  const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (arr.length === 0) return undefined;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

export function computeConsensus(game: OddsGame): MarketLines {
  // If the provider already gave a consensus (like mock fixtures), keep it as fallback
  const existingConsensus = game.books.consensus;

  const spreads: number[] = [];
  const totals: number[] = [];
  const mlHome: number[] = [];
  const mlAway: number[] = [];

  for (const [bk, l] of Object.entries(game.books) as Array<
    [BookKey, MarketLines | undefined]
  >) {
    if (!l) continue;
    if (bk === "consensus") continue;

    if (l.spread !== undefined) spreads.push(l.spread);
    if (l.total !== undefined) totals.push(l.total);
    if (l.moneylineHome !== undefined) mlHome.push(l.moneylineHome);
    if (l.moneylineAway !== undefined) mlAway.push(l.moneylineAway);
  }

  const spread = median(spreads) ?? existingConsensus?.spread;
  const total = median(totals) ?? existingConsensus?.total;
  const moneylineHome = median(mlHome) ?? existingConsensus?.moneylineHome;
  const moneylineAway = median(mlAway) ?? existingConsensus?.moneylineAway;

  return {
    spread,
    total,
    moneylineHome,
    moneylineAway,
    updatedAtISO: new Date().toISOString(),
  };
}
