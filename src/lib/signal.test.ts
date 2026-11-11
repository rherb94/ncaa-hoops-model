import { computeSignal, isPlay, cautionNote } from "./signal";

describe("computeSignal", () => {
  test("ordinary spreads: NONE / LEAN / STRONG by edge size", () => {
    expect(computeSignal(2.9, -6.5)).toBe("NONE");
    expect(computeSignal(-3, -6.5)).toBe("LEAN");
    expect(computeSignal(4.9, 2.5)).toBe("LEAN");
    expect(computeSignal(5, -6.5)).toBe("STRONG");
    expect(computeSignal(-7.9, -6.5)).toBe("STRONG");
  });
  test("edge of 8+ is CAUTION, not STRONG, and is not capped", () => {
    expect(computeSignal(8, -6.5)).toBe("CAUTION");
    expect(computeSignal(-14.2, -6.5)).toBe("CAUTION");
  });
  test("20+ point market spread turns a would-be play into CAUTION", () => {
    expect(computeSignal(5.6, -28.5)).toBe("CAUTION"); // Colgate @ St. John's, 2026-11-11
    expect(computeSignal(3.2, 20)).toBe("CAUTION");
    expect(computeSignal(5.6, -19.5)).toBe("STRONG");
  });
  test("small edge on a big spread is still just NONE", () => {
    expect(computeSignal(1.5, -31.5)).toBe("NONE");
  });
  test("missing inputs", () => {
    expect(computeSignal(undefined, -5)).toBe("NONE");
    expect(computeSignal(null)).toBe("NONE");
    expect(computeSignal(6)).toBe("STRONG"); // no market spread known
  });
});

describe("isPlay / cautionNote", () => {
  test("only LEAN and STRONG are plays", () => {
    expect(isPlay("LEAN")).toBe(true);
    expect(isPlay("STRONG")).toBe(true);
    expect(isPlay("CAUTION")).toBe(false);
    expect(isPlay("NONE")).toBe(false);
    expect(isPlay(undefined)).toBe(false);
  });
  test("note explains which rule fired", () => {
    expect(cautionNote(12, -31.5)).toMatch(/20\+ point spreads/);
    expect(cautionNote(9, -4.5)).toMatch(/news the ratings don't have/);
    expect(cautionNote(4, -4.5)).toBeUndefined();
  });
});
