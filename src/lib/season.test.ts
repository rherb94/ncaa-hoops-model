import { basketballSeasonYear } from "./season";

describe("basketballSeasonYear", () => {
  test("November belongs to the season ending next year", () => {
    expect(basketballSeasonYear(new Date("2026-11-11T12:00:00Z"))).toBe(2027);
  });
  test("March belongs to the season ending this year", () => {
    expect(basketballSeasonYear(new Date("2027-03-15T12:00:00Z"))).toBe(2027);
  });
  test("offseason (summer) still points at the season just finished", () => {
    expect(basketballSeasonYear(new Date("2027-07-01T12:00:00Z"))).toBe(2027);
  });
  test("October rolls over to the new season", () => {
    expect(basketballSeasonYear(new Date("2027-10-01T00:00:00Z"))).toBe(2028);
  });
});
