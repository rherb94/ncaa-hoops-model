// src/lib/betLinks.ts
// Builds the "add to bet slip" options shown on a play. Nothing here places a
// bet: each option is a link that opens the sportsbook with the selection
// loaded, and the stake and confirmation happen in the sportsbook itself.

import type { BookKey, MarketLines } from "@/lib/odds/types";

export type BetLinkLevel = "betslip" | "market" | "event" | "home";

export type BetOption = {
  book: "draftkings" | "fanduel";
  bookName: string;
  /** Spread for the picked team at this book (already flipped for AWAY). */
  line: number;
  /** American odds on the picked side; null if the book didn't quote one. */
  price: number | null;
  url: string;
  /**
   * How specific the link is: "betslip" loads the selection into the slip;
   * "market"/"event" open the game; "home" is the sportsbook's front page.
   */
  level: BetLinkLevel;
  /**
   * The game's own page at the sportsbook, when known and different from
   * `url`. Offered as a fallback if the bet-slip link doesn't take.
   */
  gameUrl?: string;
  /** True for the option with the best number (then best price). */
  best?: boolean;
};

const BOOKS: Record<BetOption["book"], { name: string; home: string; hosts: string[] }> = {
  draftkings: {
    name: "DraftKings",
    home: "https://sportsbook.draftkings.com/",
    hosts: ["draftkings.com"],
  },
  fanduel: {
    name: "FanDuel",
    home: "https://sportsbook.fanduel.com/",
    hosts: ["fanduel.com"],
  },
};

/**
 * Only ever link to the sportsbook's own domain over https. Links arrive from
 * a third-party API, so anything else is dropped rather than trusted.
 * Some links carry a {state} placeholder for the bettor's state.
 */
export function safeBookUrl(book: BetOption["book"], raw: unknown, state = "md"): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const filled = raw.replace(/\{state\}/gi, state.toLowerCase());
  let u: URL;
  try {
    u = new URL(filled);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const ok = BOOKS[book].hosts.some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? u.toString() : null;
}

export function buildBetOptions(
  books: Partial<Record<BookKey, MarketLines>>,
  side: "HOME" | "AWAY",
  state = process.env.SPORTSBOOK_STATE || "md"
): BetOption[] {
  const out: BetOption[] = [];

  for (const book of ["draftkings", "fanduel"] as const) {
    const l = books[book];
    if (!l || typeof l.spread !== "number" || Number.isNaN(l.spread)) continue;

    const candidates: Array<[BetLinkLevel, unknown]> = [
      ["betslip", side === "HOME" ? l.spreadLinkHome : l.spreadLinkAway],
      ["market", l.spreadMarketLink],
      ["event", l.eventLink],
    ];
    let url = BOOKS[book].home;
    let level: BetLinkLevel = "home";
    for (const [lvl, raw] of candidates) {
      const safe = safeBookUrl(book, raw, state);
      if (safe) {
        url = safe;
        level = lvl;
        break;
      }
    }

    const gameUrl =
      safeBookUrl(book, l.eventLink, state) ?? safeBookUrl(book, l.spreadMarketLink, state) ?? undefined;

    const price = side === "HOME" ? l.spreadOddsHome : l.spreadOddsAway;
    out.push({
      book,
      bookName: BOOKS[book].name,
      line: side === "HOME" ? l.spread : -l.spread,
      price: typeof price === "number" && Number.isFinite(price) ? price : null,
      url,
      level,
      gameUrl: gameUrl && gameUrl !== url ? gameUrl : undefined,
    });
  }

  // Best = most points for the picked team, then the better price.
  if (out.length) {
    const rank = (o: BetOption) => o.line * 1000 + (o.price ?? -110) / 10;
    const top = out.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    if (out.length > 1 && out.some((o) => rank(o) !== rank(top))) top.best = true;
  }
  return out;
}
