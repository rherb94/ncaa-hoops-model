// src/lib/odds/providers/theOddsApi.ts
import type { OddsProvider } from "../provider";
import type { OddsGame, OddsSlate, BookKey, MarketLines } from "../types";
import { resolveTeamId } from "@/data/teamAliases";

type OddsApiOutcome = {
  name: string; // team name OR "Over"/"Under"
  price?: number; // American odds
  point?: number; // spread/total number
};

type OddsApiMarket = {
  key: "h2h" | "spreads" | "totals";
  outcomes: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  key: string; // e.g. "draftkings", "fanduel", "betmgm"
  title: string;
  last_update: string; // ISO
  markets: OddsApiMarket[];
};

type OddsApiEvent = {
  id: string;
  sport_key: string;
  commence_time: string; // ISO (UTC Z)
  home_team: string;
  away_team: string;
  bookmakers?: OddsApiBookmaker[];
};

function asBookKey(key: string): BookKey | undefined {
  const k = key.toLowerCase();
  if (k === "draftkings") return "draftkings";
  if (k === "fanduel") return "fanduel";
  if (k === "betmgm") return "betmgm";
  if (k === "caesars") return "caesars";
  if (k === "pointsbetus" || k === "pointsbet") return "pointsbet";
  return undefined;
}

function parseBookLines(
  book: OddsApiBookmaker,
  homeTeam: string,
  awayTeam: string
): MarketLines {
  const lines: MarketLines = { updatedAtISO: book.last_update };

  for (const m of book.markets ?? []) {
    if (m.key === "h2h") {
      const home = m.outcomes.find((o) => o.name === homeTeam);
      const away = m.outcomes.find((o) => o.name === awayTeam);
      if (home?.price !== undefined) lines.moneylineHome = home.price;
      if (away?.price !== undefined) lines.moneylineAway = away.price;
    }

    if (m.key === "spreads") {
      const home = m.outcomes.find((o) => o.name === homeTeam);
      const away = m.outcomes.find((o) => o.name === awayTeam);

      // Convention: store HOME spread (negative => home favored)
      if (home?.point !== undefined) lines.spread = home.point;

      // Optional: only keep these if your MarketLines type supports them
      if (home?.price !== undefined) (lines as any).spreadOddsHome = home.price;
      if (away?.price !== undefined) (lines as any).spreadOddsAway = away.price;
    }

    if (m.key === "totals") {
      const over = m.outcomes.find((o) => o.name.toLowerCase() === "over");
      const under = m.outcomes.find((o) => o.name.toLowerCase() === "under");

      lines.total = over?.point ?? under?.point;

      // Optional: only keep these if your MarketLines type supports them
      if (over?.price !== undefined) (lines as any).totalOddsOver = over.price;
      if (under?.price !== undefined)
        (lines as any).totalOddsUnder = under.price;
    }
  }

  return lines;
}

const ET_TZ = "America/New_York";

/** Convert ISO UTC -> YYYY-MM-DD in America/New_York */
function ymdET(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export class TheOddsApiProvider implements OddsProvider {
  name = "theoddsapi";
  private readonly sportKey: string;

  constructor(sportKey = "basketball_ncaab") {
    this.sportKey = sportKey;
  }

  async getSlate(date: string, forceRefresh = false): Promise<OddsSlate> {
    const apiKey = process.env.THE_ODDS_API_KEY;
    if (!apiKey) throw new Error("Missing env THE_ODDS_API_KEY");

    const region = process.env.THE_ODDS_API_REGION ?? "us";
    const markets = process.env.THE_ODDS_API_MARKETS ?? "h2h,spreads,totals";
    const oddsFormat = process.env.THE_ODDS_API_ODDS_FORMAT ?? "american";

    const url =
      `https://api.the-odds-api.com/v4/sports/${this.sportKey}/odds` +
      `?regions=${encodeURIComponent(region)}` +
      `&markets=${encodeURIComponent(markets)}` +
      `&oddsFormat=${encodeURIComponent(oddsFormat)}` +
      `&apiKey=${encodeURIComponent(apiKey)}`;

    const res = await fetch(
      url,
      forceRefresh
        ? { cache: "no-store" }
        : { next: { revalidate: 3600 } } // cache for 1 hour; busted by "Refresh odds"
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`TheOddsAPI error ${res.status}: ${text}`);
    }

    const events = (await res.json()) as OddsApiEvent[];

    const games: OddsGame[] = events
      .filter((e) => ymdET(e.commence_time) === date)
      .map((e) => {
        const homeTeamName = e.home_team;
        const awayTeamName = e.away_team;

        const homeTeamId =
          resolveTeamId({
            provider: "theoddsapi",
            teamName: homeTeamName,
          }) ?? undefined;

        const awayTeamId =
          resolveTeamId({
            provider: "theoddsapi",
            teamName: awayTeamName,
          }) ?? undefined;

        if (!homeTeamId) console.warn("UNMAPPED HOME:", homeTeamName);
        if (!awayTeamId) console.warn("UNMAPPED AWAY:", awayTeamName);

        const books: OddsGame["books"] = {};
        for (const b of e.bookmakers ?? []) {
          const bk = asBookKey(b.key);
          if (!bk) continue;
          books[bk] = parseBookLines(b, homeTeamName, awayTeamName);
        }

        return {
          gameId: e.id,
          startTimeISO: e.commence_time,
          homeTeam: homeTeamName,
          awayTeam: awayTeamName,
          homeTeamId: homeTeamId ?? `unmapped-${e.id}-home`,
          awayTeamId: awayTeamId ?? `unmapped-${e.id}-away`,
          books,
        };
      });

    return {
      date,
      lastUpdatedISO: new Date().toISOString(),
      games,
    };
  }
}
