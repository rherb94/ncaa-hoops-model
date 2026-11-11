import { winProfit, unitsFor, breakEvenPct, pickPrice } from "./grading";

describe("grading", () => {
  test("win profit at common prices", () => {
    expect(winProfit(-110)).toBeCloseTo(0.9091, 4);
    expect(winProfit(-105)).toBeCloseTo(0.9524, 4);
    expect(winProfit(-120)).toBeCloseTo(0.8333, 4);
    expect(winProfit(100)).toBe(1);
    expect(winProfit(105)).toBe(1.05);
  });
  test("units by result", () => {
    expect(unitsFor("WIN", -110)).toBeCloseTo(0.9091, 4);
    expect(unitsFor("LOSS", -110)).toBe(-1);
    expect(unitsFor("LOSS", 105)).toBe(-1);
    expect(unitsFor("PUSH", -110)).toBe(0);
    expect(unitsFor("NO_PICK")).toBeNull();
    expect(unitsFor("PENDING")).toBeNull();
  });
  test("break-even win rate", () => {
    expect(breakEvenPct(-110)).toBeCloseTo(0.5238, 4);
    expect(breakEvenPct(100)).toBe(0.5);
  });
  test("pick price comes from the picked side, else assumes -110", () => {
    const opening = { homePrice: -108, awayPrice: -112 };
    expect(pickPrice("HOME", opening)).toEqual({ price: -108, assumed: false });
    expect(pickPrice("AWAY", opening)).toEqual({ price: -112, assumed: false });
    expect(pickPrice("HOME", { homePrice: null })).toEqual({ price: -110, assumed: true });
    expect(pickPrice("AWAY", null)).toEqual({ price: -110, assumed: true });
  });
});
