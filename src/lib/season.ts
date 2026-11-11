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
