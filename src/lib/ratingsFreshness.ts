// src/lib/ratingsFreshness.ts
// Decides whether the team ratings the model runs on are out of date.
// Pure (no fs) so the API, the scripts and the tests can all share it.

export type RatingsMeta = {
  /** ISO timestamp of the last successful ratings pull. */
  updatedAt: string;
  season?: string;
  source?: string;
};

export type RatingsStatus = {
  updatedAt: string | null;
  ageHours: number | null;
  stale: boolean;
  /** Human-readable explanation, only set when stale. */
  message?: string;
};

// Ratings are pulled once a day at 7am ET. Just before the next pull they are
// ~24h old (a little more if GitHub starts the job late), so anything past 26h
// means that morning's pull did not land — early enough to show before the
// 11am ET odds snapshot uses them.
export const STALE_AFTER_HOURS = 26;

/** Nov 1 – Apr 10. Outside it ratings don't change, so old is not "stale". */
export function inBasketballSeason(now: Date = new Date()): boolean {
  const m = now.getUTCMonth(); // 0 = Jan
  if (m >= 10 || m <= 2) return true;
  return m === 3 && now.getUTCDate() <= 10;
}

export function ratingsStatus(meta: RatingsMeta | null, now: Date = new Date()): RatingsStatus {
  const inSeason = inBasketballSeason(now);
  const t = meta?.updatedAt ? Date.parse(meta.updatedAt) : NaN;

  if (!Number.isFinite(t)) {
    return {
      updatedAt: null,
      ageHours: null,
      stale: inSeason,
      message: inSeason
        ? "Ratings are stale."
        : undefined,
    };
  }

  const ageHours = Math.max(0, (now.getTime() - t) / 3_600_000);
  const stale = inSeason && ageHours > STALE_AFTER_HOURS;
  return {
    updatedAt: new Date(t).toISOString(),
    ageHours: Math.round(ageHours * 10) / 10,
    stale,
    message: stale
      ? `Ratings are stale (${formatAge(ageHours)} old).`
      : undefined,
  };
}

export function formatAge(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
