export type ConsensusOdds = {
  spread?: number; // HOME spread (negative = home favored)
  total?: number;
  moneylineHome?: number;
  moneylineAway?: number;
  source: string;
  updatedAtISO?: string;
};

export type ModelSignal = "NONE" | "LEAN" | "STRONG";

export type ModelBlock = {
  awayPR: number;
  homePR: number;
  hca: number;
  modelSpread: number; // HOME spread (negative = home favored)
  edge?: number; // modelSpread - marketSpread (both HOME spread convention)
  signal: ModelSignal;
};

export type GameOverrideInfo = {
  forceHome?: boolean;
  skip?: boolean;
  reason?: string;
};

export type RecommendedBet = {
  market: "SPREAD";
  side: "HOME" | "AWAY" | "NONE";
  line?: number; // HOME spread convention
  book?: string;
};

export type SlateGame = {
  gameId: string;
  startTimeISO: string;
  neutralSite?: boolean;

  awayTeamId: string;
  homeTeamId: string;

  awayTeam: string;
  homeTeam: string;

  // ✅ logos
  awayLogo?: string;
  homeLogo?: string;

  // Opening spread from the opener snapshot (for line movement display)
  openingSpread?: number;

  consensus: ConsensusOdds;
  model: ModelBlock;

  recommended?: RecommendedBet;

  // Override flags (populated when overrides.json has entries for this game)
  overrides?: GameOverrideInfo;
};

export type UnmappedAlias = {
  teamName: string;
  suggestedTeamId: string;
  teamId: string;
};

export type SlateResponse = {
  date: string;
  lastUpdatedISO: string;
  games: SlateGame[];
  unmappedAliases?: UnmappedAlias[];
};

export type DateSlate = {
  date: string;
  games: SlateGame[];
};

export type UpcomingResponse = {
  lastUpdatedISO: string;
  dates: DateSlate[];
};
