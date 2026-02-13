import type { OddsProvider } from "./provider";
import type { OddsSlate } from "./types";
import { MockFixtureProvider } from "./providers/mock";
import { computeConsensus } from "./consensus";
import { TheOddsApiProvider } from "./providers/theOddsApi";

const DEFAULT_TTL_MS = 60_000; // 1 minute

type CacheEntry = { expiresAt: number; value: OddsSlate };

const cache = new Map<string, CacheEntry>();

function cacheKey(date: string) {
  return `slate:${date}`;
}

export function getOddsProvider(): OddsProvider {
  const which = (process.env.ODDS_PROVIDER ?? "mock").toLowerCase();

  if (which === "theoddsapi") return new TheOddsApiProvider();

  return new MockFixtureProvider();
}

export async function getOddsSlate(
  date: string,
  opts?: { refresh?: boolean; ttlMs?: number }
): Promise<OddsSlate> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const key = cacheKey(date);

  if (!opts?.refresh) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  const provider = getOddsProvider();
  const slate = await provider.getSlate(date);

  // add/refresh consensus per game based on available books
  const enriched: OddsSlate = {
    ...slate,
    games: slate.games.map((g) => ({
      ...g,
      books: {
        ...g.books,
        consensus: computeConsensus(g),
      },
    })),
    lastUpdatedISO: new Date().toISOString(),
  };

  cache.set(key, { value: enriched, expiresAt: Date.now() + ttlMs });
  return enriched;
}
