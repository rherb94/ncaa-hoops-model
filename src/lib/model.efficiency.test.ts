// src/lib/model.efficiency.test.ts
import { computeEfficiencyModel } from "./model";
import type { Team } from "@/data/teams";

const team = (p: Partial<Team>): Team =>
  ({
    id: "x",
    slug: "x",
    displayName: "x",
    shortDisplayName: "x",
    name: "x",
    location: "x",
    isActive: true,
    logos: [],
    powerRating: 0,
    hca: 2,
    ...p,
  } as any);

describe("Efficiency model math", () => {
  const mk = (p: Partial<Team>): Team => ({ ...(p as any) });

  test("swap teams w/ HCA=0 => modelSpread should flip sign", () => {
    const a = mk({ adjO: 112, adjD: 98, tempo: 70 });
    const b = mk({ adjO: 104, adjD: 106, tempo: 66 });

    const ab = computeEfficiencyModel(a as any, b as any, 0)!;
    const ba = computeEfficiencyModel(b as any, a as any, 0)!;

    expect(ab.modelSpread).toBeCloseTo(-ba.modelSpread, 1);
  });
  test("golden: outputs match step-by-step math (incl HCA + sign)", () => {
    const home = team({ adjO: 110, adjD: 102, tempo: 70, hca: 2 });
    const away = team({ adjO: 105, adjD: 108, tempo: 66 });

    const out = computeEfficiencyModel(home, away, 2)!;

    // possessions = avg(70,66)=68.0
    expect(out.possessions).toBe(68);

    // homePP100 = 110 + (108-100)=118
    // awayPP100 = 105 + (102-100)=107
    expect(out.homePP100).toBe(118);
    expect(out.awayPP100).toBe(107);

    // ep=0.68 => homePts=80.2, awayPts=72.8
    expect(out.homePts).toBe(80.2);
    expect(out.awayPts).toBe(72.8);

    // marginPer100=11.0, scaledMargin=7.5, homeMarginPts=9.5
    expect(out.marginPer100).toBe(11);
    expect(out.scaledMargin).toBe(7.5);
    expect(out.homeMarginPts).toBe(9.5);

    // spread = -homeMarginPts => -9.5 (home favored)
    expect(out.modelSpread).toBe(-9.5);

    // total = 153.0
    expect(out.modelTotal).toBe(153);
  });
  test("HCA shifts spread by exactly -HCA (home advantage makes spread more negative)", () => {
    const home: any = { adjO: 110, adjD: 102, tempo: 70 };
    const away: any = { adjO: 105, adjD: 108, tempo: 66 };

    const h0 = computeEfficiencyModel(home, away, 0)!;
    const h2 = computeEfficiencyModel(home, away, 2)!;

    expect(h2.modelSpread - h0.modelSpread).toBeCloseTo(-2, 1);
  });
  test("possessions are clamped to [56,78]", () => {
    const fast: any = { adjO: 110, adjD: 100, tempo: 95 };
    const faster: any = { adjO: 110, adjD: 100, tempo: 92 };
    const slow: any = { adjO: 110, adjD: 100, tempo: 45 };

    expect(computeEfficiencyModel(fast, faster, 0)!.possessions).toBe(78);
    expect(computeEfficiencyModel(slow, slow, 0)!.possessions).toBe(56);
  });
  test("total is clamped to [95,190]", () => {
    const nukeO: any = { adjO: 180, adjD: 80, tempo: 78 };
    const nukeD: any = { adjO: 180, adjD: 80, tempo: 78 };

    // Very low offense + very strong defense + slow tempo
    // homePP100 = 60 + (85-100)=45
    // awayPP100 = 60 + (85-100)=45
    // possessions clamped to 56 => total = 45*0.56*2 = 50.4 => clamp to 95
    const brickA: any = { adjO: 60, adjD: 85, tempo: 50 };
    const brickB: any = { adjO: 60, adjD: 85, tempo: 50 };

    expect(computeEfficiencyModel(nukeO, nukeD, 0)!.modelTotal).toBe(190);
    expect(computeEfficiencyModel(brickA, brickB, 0)!.modelTotal).toBe(95);
  });

  test("total clamp engages when raw total is outside bounds", () => {
    const brickA: any = { adjO: 60, adjD: 85, tempo: 50 };
    const brickB: any = { adjO: 60, adjD: 85, tempo: 50 };

    const out = computeEfficiencyModel(brickA, brickB, 0)!;
    expect(out.homePts + out.awayPts).toBeLessThan(95);
    expect(out.modelTotal).toBe(95);
  });

  test("returns undefined if required torvik fields missing", () => {
    const bad: any = { adjO: 110, adjD: 100 }; // tempo missing
    const ok: any = { adjO: 110, adjD: 100, tempo: 70 };

    expect(computeEfficiencyModel(bad, ok, 0)).toBeUndefined();
    expect(computeEfficiencyModel(ok, bad, 0)).toBeUndefined();
  });
});
