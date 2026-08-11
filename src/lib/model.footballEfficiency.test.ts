// src/lib/model.footballEfficiency.test.ts
import { computeFootballEfficiencyModel } from "./model";
import type { Team } from "@/data/teams";

const team = (p: Partial<Team>): Team => ({ ...(p as any) });

describe("Football efficiency model math", () => {
  test("swap teams w/ HCA=0 => modelSpread should flip sign", () => {
    const a = team({ adjO: 40, adjD: 10, tempo: 70 });
    const b = team({ adjO: 30, adjD: 20, tempo: 65 });

    const ab = computeFootballEfficiencyModel(a, b, 0)!;
    const ba = computeFootballEfficiencyModel(b, a, 0)!;

    expect(ab.modelSpread).toBeCloseTo(-ba.modelSpread, 1);
  });

  test("golden: outputs match step-by-step math (incl HCA + sign)", () => {
    const home = team({ adjO: 40, adjD: 10, tempo: 70, hca: 2 });
    const away = team({ adjO: 30, adjD: 20, tempo: 65 });

    const out = computeFootballEfficiencyModel(home, away, 2)!;

    // plays = avg(70,65) = 67.5
    expect(out.plays).toBe(67.5);

    // homeOffPP=40/70=0.5714  homeDefPP=10/70=0.1429
    // awayOffPP=30/65=0.4615  awayDefPP=20/65=0.3077
    // homePPPlay = homeOffPP + (awayDefPP - 0.397) = 0.482
    // awayPPPlay = awayOffPP + (homeDefPP - 0.397) = 0.207
    expect(out.homePPPlay).toBeCloseTo(0.482, 3);
    expect(out.awayPPPlay).toBeCloseTo(0.207, 3);

    // homePts = 0.482*67.5=32.5  awayPts = 0.207*67.5=14.0
    expect(out.homePts).toBeCloseTo(32.5, 1);
    expect(out.awayPts).toBeCloseTo(14.0, 1);

    // marginPerPlay=0.275, scaledMargin=18.5, homeMarginPts=20.5
    expect(out.marginPerPlay).toBeCloseTo(0.275, 3);
    expect(out.scaledMargin).toBeCloseTo(18.5, 1);
    expect(out.homeMarginPts).toBeCloseTo(20.5, 1);

    // spread = -homeMarginPts => -20.5 (home favored)
    expect(out.modelSpread).toBeCloseTo(-20.5, 1);

    // total = 46.5
    expect(out.modelTotal).toBeCloseTo(46.5, 1);
  });

  test("HCA shifts spread by exactly -HCA", () => {
    const home = team({ adjO: 40, adjD: 10, tempo: 70 });
    const away = team({ adjO: 30, adjD: 20, tempo: 65 });

    const h0 = computeFootballEfficiencyModel(home, away, 0)!;
    const h2 = computeFootballEfficiencyModel(home, away, 2)!;

    expect(h2.modelSpread - h0.modelSpread).toBeCloseTo(-2, 1);
  });

  test("plays are clamped to [55,85]", () => {
    const fast = team({ adjO: 30, adjD: 20, tempo: 95 });
    const faster = team({ adjO: 30, adjD: 20, tempo: 92 });
    const slow = team({ adjO: 30, adjD: 20, tempo: 45 });

    expect(computeFootballEfficiencyModel(fast, faster, 0)!.plays).toBe(85);
    expect(computeFootballEfficiencyModel(slow, slow, 0)!.plays).toBe(55);
  });

  test("total is clamped to [24,90]", () => {
    const highOctane = team({ adjO: 45, adjD: 5, tempo: 85 });
    const stalemate = team({ adjO: 8, adjD: 42, tempo: 55 });

    expect(computeFootballEfficiencyModel(highOctane, highOctane, 0)!.modelTotal).toBeLessThanOrEqual(90);
    expect(computeFootballEfficiencyModel(stalemate, stalemate, 0)!.modelTotal).toBeGreaterThanOrEqual(24);
  });

  test("returns undefined if required cfbd fields missing", () => {
    const bad = team({ adjO: 30, adjD: 20 }); // tempo missing
    const ok = team({ adjO: 30, adjD: 20, tempo: 65 });

    expect(computeFootballEfficiencyModel(bad, ok, 0)).toBeUndefined();
    expect(computeFootballEfficiencyModel(ok, bad, 0)).toBeUndefined();
  });

  test("returns undefined if tempo is zero (would divide by zero)", () => {
    const zeroTempo = team({ adjO: 30, adjD: 20, tempo: 0 });
    const ok = team({ adjO: 30, adjD: 20, tempo: 65 });

    expect(computeFootballEfficiencyModel(zeroTempo, ok, 0)).toBeUndefined();
  });
});
