// src/data/ratingsMeta.ts
// Reads src/data/<league>/ratingsMeta.json, the heartbeat file the ratings
// update script writes on every successful pull.
import fs from "node:fs";
import path from "node:path";
import { ratingsStatus } from "@/lib/ratingsFreshness";
import type { RatingsMeta, RatingsStatus } from "@/lib/ratingsFreshness";

export function ratingsMetaPath(league: string): string {
  return path.join(process.cwd(), "src", "data", league, "ratingsMeta.json");
}

export function loadRatingsMeta(league: string): RatingsMeta | null {
  try {
    const meta = JSON.parse(fs.readFileSync(ratingsMetaPath(league), "utf-8")) as RatingsMeta;
    return meta?.updatedAt ? meta : null;
  } catch {
    return null;
  }
}

export function writeRatingsMeta(league: string, meta: RatingsMeta) {
  fs.writeFileSync(ratingsMetaPath(league), JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

/**
 * Freshness for a league. Only the Torvik (basketball) leagues are tracked
 * for now; other leagues report "not stale" so nothing warns falsely.
 */
export function getRatingsStatus(league: string, now: Date = new Date()): RatingsStatus {
  if (league !== "ncaam" && league !== "ncaaw") {
    return { updatedAt: loadRatingsMeta(league)?.updatedAt ?? null, ageHours: null, stale: false };
  }
  return ratingsStatus(loadRatingsMeta(league), now);
}
