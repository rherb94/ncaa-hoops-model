export type BookKey =
  | "draftkings"
  | "fanduel"
  | "betmgm"
  | "caesars"
  | "pointsbet"
  | "betrivers"
  | "consensus";

export type MarketLines = {
  spread?: number; // home spread (e.g., -2.5 means home -2.5)
  spreadOddsHome?: number; // american odds (e.g., -110)
  spreadOddsAway?: number;

  total?: number;
  totalOddsOver?: number;
  totalOddsUnder?: number;

  moneylineHome?: number;
  moneylineAway?: number;

  updatedAtISO?: string;

  // Sportsbook deep links (from TheOddsAPI's includeLinks). Any may be absent.
  /** Adds the home / away spread selection to the bet slip. */
  spreadLinkHome?: string;
  spreadLinkAway?: string;
  /** The spread market for this game. */
  spreadMarketLink?: string;
  /** The game's page at the sportsbook. */
  eventLink?: string;
};

export type OddsGame = {
  gameId: string;
  startTimeISO: string;

  awayTeamId: string;
  homeTeamId: string;

  awayTeam: string;
  homeTeam: string;

  // lines by book (DK/FD/MGM/etc.)
  books: Partial<Record<BookKey, MarketLines>>;
};

export type OddsSlate = {
  date: string; // YYYY-MM-DD
  lastUpdatedISO: string;
  games: OddsGame[];
};
