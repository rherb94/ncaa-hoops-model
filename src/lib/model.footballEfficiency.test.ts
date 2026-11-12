// src/lib/model.footballEfficiency.test.ts
import { computeFootballModel, computeAnyEfficiencyModel, CFB_AVG_GAME_POINTS, CFB_DEFAULT_HCA } from "./model";
import type { Team } from "@/data/teams";

const team = (p: Partial<Team>): Team => ({ teamId: "t", name: "T", powerRating: 0, hca: CFB_DEFAULT_HCA, ...p });

describe("Football model (SP+)", () => {
  test("spread is the SP+ difference plus home field, home-spread convention", () => {
    const home = team({ powerRating: 10 });
    const away = team({ powerRating: 4 });
    expect(computeFootballModel(home, away, 3)!.modelSpread).toBe(-9);   // home by 9
    expect(computeFootballModel(away, home, 3)!.modelSpread).toBe(3);    // home dog by 3
  });

  test("neutral site (hca 0) flips sign cleanly", () => {
    const a = team({ powerRating: 12.5 });
    const b = team({ powerRating: -3 });
    expect(computeFootballModel(a, b, 0)!.modelSpread).toBe(-computeFootballModel(b, a, 0)!.modelSpread);
  });

  test("defaults to the team's hca, then the league default", () => {
    expect(computeFootballModel(team({ powerRating: 0, hca: 2 }), team({}))!.hcaUsed).toBe(2);
    expect(computeFootballModel(team({ powerRating: 0, hca: NaN }), team({}))!.hcaUsed).toBe(CFB_DEFAULT_HCA);
  });

  test("total and scores agree with offense/defense ratings and the margin", () => {
    const home = team({ powerRating: 10, adjO: 34, adjD: 22 });
    const away = team({ powerRating: 0, adjO: 27, adjD: 27 });
    const out = computeFootballModel(home, away, 3)!;
    // 34 + 27 + 27 + 22 − 52.5 = 57.5
    expect(out.modelTotal).toBeCloseTo(34 + 27 + 27 + 22 - CFB_AVG_GAME_POINTS, 1);
    expect(out.homePts! - out.awayPts!).toBeCloseTo(13, 0);
    expect(out.homePts! + out.awayPts!).toBeCloseTo(out.modelTotal!, 0);
  });

  test("missing offense/defense still gives a spread, just no total", () => {
    const out = computeFootballModel(team({ powerRating: 5 }), team({ powerRating: 1 }), 3)!;
    expect(out.modelSpread).toBe(-7);
    expect(out.modelTotal).toBeUndefined();
  });

  test("missing overall rating gives no model", () => {
    expect(computeFootballModel(team({ powerRating: NaN }), team({}), 3)).toBeUndefined();
  });

  test("dispatcher routes cfb to the football model", () => {
    const out = computeAnyEfficiencyModel("cfb", team({ powerRating: 10 }), team({ powerRating: 4 }), 3);
    expect(out?.modelSpread).toBe(-9);
  });
});
