// src/lib/model.test.ts
import { computeModelSpread, computeEdge, computeSignal } from "./model";

describe("Spread / edge conventions (home-spread convention)", () => {
  test("computeModelSpread: home better => negative spread (home favored)", () => {
    // homeMargin = homePR + hca - awayPR = 10 + 2 - 6 = +6
    // spread = -homeMargin = -6
    expect(computeModelSpread(10, 6, 2)).toBe(-6);
  });

  test("computeModelSpread: away better => positive spread (home underdog)", () => {
    // homeMargin = 6 + 2 - 10 = -2
    // spread = -(-2) = +2
    expect(computeModelSpread(6, 10, 2)).toBe(2);
  });

  test("computeEdge: model - market (both are home-spread)", () => {
    // Market: home -6.5
    // Model:  home -4.5 (model likes home less than market)
    // edge = -4.5 - (-6.5) = +2.0 => value is on AWAY +6.5
    expect(computeEdge(-4.5, -6.5)).toBe(2);
  });

  test("computeEdge: positive edge means value on AWAY, negative edge means value on HOME", () => {
    const market = -6.5;

    const modelLikesAway = -4.5; // less negative than market => closer game
    const edgeA = computeEdge(modelLikesAway, market)!;
    expect(edgeA).toBeGreaterThan(0);

    const modelLikesHome = -9.0; // more negative than market => bigger home win
    const edgeH = computeEdge(modelLikesHome, market)!;
    expect(edgeH).toBeLessThan(0);
  });

  test("computeSignal thresholds", () => {
    expect(computeSignal(undefined)).toBe("NONE");
    expect(computeSignal(2.9)).toBe("NONE");
    expect(computeSignal(3.0)).toBe("LEAN");
    expect(computeSignal(4.9)).toBe("LEAN");
    expect(computeSignal(5.0)).toBe("STRONG");
  });

  test("pick side rule (matches your route): edge < 0 => HOME, edge > 0 => AWAY", () => {
    // replicate your route logic in a tiny helper
    const sideFromEdge = (edge?: number) => {
      if (edge === undefined) return "NONE";
      const signal = computeSignal(edge);
      if (signal === "NONE") return "NONE";
      return edge < 0 ? "HOME" : "AWAY";
    };

    expect(sideFromEdge(-3.1)).toBe("HOME");
    expect(sideFromEdge(3.1)).toBe("AWAY");
    expect(sideFromEdge(2.0)).toBe("NONE");
    expect(sideFromEdge(undefined)).toBe("NONE");
  });

  test("home underdog case: still works (positive market spread)", () => {
    // Market: home +6.5 (home is underdog)
    // If model says home +2.0 (closer than market), that's value on HOME +6.5
    // edge = +2.0 - +6.5 = -4.5 => HOME
    const edge = computeEdge(2.0, 6.5)!;
    expect(edge).toBe(-4.5);
    expect(computeSignal(edge)).toBe("LEAN");
  });
});
