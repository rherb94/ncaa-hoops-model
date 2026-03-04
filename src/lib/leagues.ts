// src/lib/leagues.ts
// Central configuration for every league the app supports.
// All league-specific constants (API keys, URL paths, ESPN sport identifiers)
// live here so adding a new league is a single-file change.

export type LeagueId = "ncaam" | "ncaaw";

export type LeagueConfig = {
  id: LeagueId;
  name: string;         // e.g. "Men's College Basketball"
  shortName: string;    // e.g. "NCAAM" (used in nav tabs)
  /** TheOddsAPI sport key, e.g. "basketball_ncaab" */
  sportKey: string;
  /** ESPN sport path segment, e.g. "mens-college-basketball" */
  espnSport: string;
  /** ESPN scoreboard ?groups= param for filtering D-I games */
  espnGroupId: string;
  /** Torvik CSV URL for a given season year */
  torvikUrl: (year: string) => string;
};

export const LEAGUES: Record<LeagueId, LeagueConfig> = {
  ncaam: {
    id: "ncaam",
    name: "Men's College Basketball",
    shortName: "NCAAM",
    sportKey: "basketball_ncaab",
    espnSport: "mens-college-basketball",
    espnGroupId: "50",
    torvikUrl: (y) => `https://barttorvik.com/${y}_team_results.csv`,
  },
  ncaaw: {
    id: "ncaaw",
    name: "Women's College Basketball",
    shortName: "NCAAW",
    // TheOddsAPI key for women's college basketball (confirmed: basketball_wncaab)
    sportKey: "basketball_wncaab",
    espnSport: "womens-college-basketball",
    espnGroupId: "50",
    torvikUrl: (y) => `https://barttorvik.com/ncaaw/${y}_team_results.csv`,
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
