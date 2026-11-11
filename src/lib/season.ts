// src/lib/season.ts
// Season-year helpers so nothing has to be edited by hand each fall.

/**
 * College basketball seasons are labelled by the year they END in
 * (Nov 2026 – Apr 2027 is "2027"). Torvik publishes the new season's file
 * with preseason projections in the fall, so from October onward we point at
 * the next calendar year.
 */
export function basketballSeasonYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0 = Jan
  return month >= 9 ? year + 1 : year;
}

/**
 * First date (YYYY-MM-DD) of the season currently being tracked. Performance
 * pages only count dates on or after this, so each season starts from a clean
 * record instead of inheriting last year's.
 *   Basketball: Nov 1 of the year the season starts in.
 *   Football:   Aug 1 of the season's calendar year (season runs Aug–Jan).
 */
export function seasonStartDate(leagueId: string, now: Date = new Date()): string {
  if (leagueId === "cfb") {
    const year = now.getUTCFullYear();
    return `${now.getUTCMonth() >= 7 ? year : year - 1}-08-01`;
  }
  return `${basketballSeasonYear(now) - 1}-11-01`;
}

/**
 * Keep only dates in the current season. Pass `season = "all"` (the
 * `?season=all` query param) to see every season on record.
 */
export function filterToCurrentSeason(
  dates: string[],
  leagueId: string,
  season?: string | null,
  now: Date = new Date()
): string[] {
  if (season === "all") return dates;
  const start = seasonStartDate(leagueId, now);
  return dates.filter((d) => d >= start);
}
