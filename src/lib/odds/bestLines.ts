// src/lib/odds/bestLines.ts
import type { BookKey, MarketLines } from "./types"; // adjust path if yours differs

export type BestSpreadLine = {
  side: "HOME" | "AWAY";
  line: number; // HOME spread convention
  book: BookKey;
  updatedAtISO?: string;
};

// Best for betting HOME: maximize home spread (e.g., -3 is better than -3.5; +4 is better than +3.5)
function betterForHome(a: number, b: number) {
  return a > b;
}

// Best for betting AWAY: minimize home spread (because away spread = -homeSpread)
function betterForAway(a: number, b: number) {
  return a < b;
}

export function pickBestSpreadForSide(
  books: Partial<Record<BookKey, MarketLines>>,
  side: "HOME" | "AWAY"
): BestSpreadLine | undefined {
  let best: BestSpreadLine | undefined;

  for (const [book, lines] of Object.entries(books) as Array<
    [BookKey, MarketLines]
  >) {
    const spread = lines?.spread;
    if (spread === undefined || Number.isNaN(spread)) continue;

    if (!best) {
      best = { side, line: spread, book, updatedAtISO: lines.updatedAtISO };
      continue;
    }

    const isBetter =
      side === "HOME"
        ? betterForHome(spread, best.line)
        : betterForAway(spread, best.line);

    if (isBetter) {
      best = { side, line: spread, book, updatedAtISO: lines.updatedAtISO };
    }
  }

  return best;
}
