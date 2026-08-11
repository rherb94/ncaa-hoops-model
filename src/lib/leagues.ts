// src/lib/leagues.ts
// Central configuration for every league the app supports.
// All league-specific constants (API keys, URL paths, ESPN sport identifiers)
// live here so adding a new league is a single-file change.

export type LeagueId = "ncaam" | "ncaaw" | "cfb";

/** Which ESPN sport family the league lives under, e.g. site.api.espn.com/apis/site/v2/sports/<family>/... */
export type EspnSportFamily = "basketball" | "football";

/** Where team ratings come from — determines which ingestion script populates teams.csv */
export type RatingsSource = "torvik" | "cfbd";

export type LeagueConfig = {
  id: LeagueId;
  name: string;         // e.g. "Men's College Basketball"
  shortName: string;    // e.g. "NCAAM" (used in nav tabs)
  /** TheOddsAPI sport key, e.g. "basketball_ncaab" */
  sportKey: string;
  /** ESPN sport family path segment, e.g. "basketball" or "football" */
  espnSportFamily: EspnSportFamily;
  /** ESPN sport path segment, e.g. "mens-college-basketball" */
  espnSport: string;
  /** ESPN scoreboard ?groups= param for filtering top-division games */
  espnGroupId: string;
  /** Which ratings ingestion source populates this league's teams.csv */
  ratingsSource: RatingsSource;
};

export const LEAGUES: Record<LeagueId, LeagueConfig> = {
  ncaam: {
    id: "ncaam",
    name: "Men's College Basketball",
    shortName: "NCAAM",
    sportKey: "basketball_ncaab",
    espnSportFamily: "basketball",
    espnSport: "mens-college-basketball",
    espnGroupId: "50",
    ratingsSource: "torvik",
  },
  ncaaw: {
    id: "ncaaw",
    name: "Women's College Basketball",
    shortName: "NCAAW",
    // TheOddsAPI key for women's college basketball (confirmed: basketball_wncaab)
    sportKey: "basketball_wncaab",
    espnSportFamily: "basketball",
    espnSport: "womens-college-basketball",
    espnGroupId: "50",
    ratingsSource: "torvik",
  },
  cfb: {
    id: "cfb",
    name: "College Football",
    shortName: "CFB",
    // TheOddsAPI key for NCAAF
    sportKey: "americanfootball_ncaaf",
    espnSportFamily: "football",
    espnSport: "college-football",
    // FBS group id — verified against live ESPN scoreboard response in updateTeamsFromCfbd research spike
    espnGroupId: "80",
    ratingsSource: "cfbd",
  },
};

/** Returns the config for a league ID, throwing on unknown values. */
export function getLeague(id: string): LeagueConfig {
  const league = LEAGUES[id as LeagueId];
  if (!league) throw new Error(`Unknown league: "${id}". Valid values: ${Object.keys(LEAGUES).join(", ")}`);
  return league;
}

/** Type-guard: returns true if the string is a valid LeagueId. */
export function isLeagueId(id: string): id is LeagueId {
  return id in LEAGUES;
}
