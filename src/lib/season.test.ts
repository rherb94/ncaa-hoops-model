import { basketballSeasonYear, footballSeasonYear, seasonStartDate, filterToCurrentSeason } from "./season";

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

describe("seasonStartDate / filterToCurrentSeason", () => {
  const nov = new Date("2026-11-11T12:00:00Z");
  test("basketball season starts Nov 1 of the starting year", () => {
    expect(seasonStartDate("ncaam", nov)).toBe("2026-11-01");
    expect(seasonStartDate("ncaaw", new Date("2027-03-20T12:00:00Z"))).toBe("2026-11-01");
  });
  test("football season starts Aug 1 and runs through January", () => {
    expect(seasonStartDate("cfb", nov)).toBe("2026-08-01");
    expect(seasonStartDate("cfb", new Date("2027-01-10T12:00:00Z"))).toBe("2026-08-01");
  });
  test("last season's dates are dropped unless season=all", () => {
    const dates = ["2026-03-02", "2026-04-06", "2026-11-12"];
    expect(filterToCurrentSeason(dates, "ncaam", null, nov)).toEqual(["2026-11-12"]);
    expect(filterToCurrentSeason(dates, "ncaam", "all", nov)).toEqual(dates);
  });
});

describe("footballSeasonYear", () => {
  test("fall and January belong to the season that started in the fall", () => {
    expect(footballSeasonYear(new Date("2026-11-12T12:00:00Z"))).toBe(2026);
    expect(footballSeasonYear(new Date("2027-01-10T12:00:00Z"))).toBe(2026);
    expect(footballSeasonYear(new Date("2027-08-01T12:00:00Z"))).toBe(2027);
  });
});
