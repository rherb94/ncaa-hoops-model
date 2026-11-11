import { ratingsStatus, inBasketballSeason } from "./ratingsFreshness";

const at = (iso: string) => new Date(iso);

describe("ratingsStatus", () => {
  test("fresh: this morning's 7am ET pull, viewed at 11am ET", () => {
    const s = ratingsStatus({ updatedAt: "2026-11-12T12:03:00Z" }, at("2026-11-12T16:00:00Z"));
    expect(s.stale).toBe(false);
    expect(s.message).toBeUndefined();
  });
  test("still fresh just before the next day's pull, even if GitHub is late", () => {
    const s = ratingsStatus({ updatedAt: "2026-11-12T12:03:00Z" }, at("2026-11-13T12:45:00Z"));
    expect(s.stale).toBe(false);
  });
  test("stale: yesterday's pull, today's failed, viewed before the 11am snapshot", () => {
    const s = ratingsStatus({ updatedAt: "2026-11-12T12:03:00Z" }, at("2026-11-13T15:30:00Z"));
    expect(s.stale).toBe(true);
    expect(s.message).toMatch(/27 hours old/);
  });
  test("several days stale reads in days", () => {
    const s = ratingsStatus({ updatedAt: "2026-11-12T12:00:00Z" }, at("2026-11-16T12:00:00Z"));
    expect(s.message).toMatch(/4 days old/);
  });
  test("no metadata at all counts as stale in season", () => {
    expect(ratingsStatus(null, at("2026-11-13T15:30:00Z")).stale).toBe(true);
  });
  test("off-season: old ratings are expected, never flagged", () => {
    expect(ratingsStatus({ updatedAt: "2027-04-08T12:00:00Z" }, at("2027-07-01T12:00:00Z")).stale).toBe(false);
    expect(ratingsStatus(null, at("2027-07-01T12:00:00Z")).stale).toBe(false);
  });
});

describe("inBasketballSeason", () => {
  test("season window", () => {
    expect(inBasketballSeason(at("2026-11-01T12:00:00Z"))).toBe(true);
    expect(inBasketballSeason(at("2027-04-06T12:00:00Z"))).toBe(true);
    expect(inBasketballSeason(at("2027-04-20T12:00:00Z"))).toBe(false);
    expect(inBasketballSeason(at("2026-10-15T12:00:00Z"))).toBe(false);
  });
});
