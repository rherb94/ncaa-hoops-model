// src/lib/model.ts
// Drop-in replacement.
// Keeps your existing API (computeModelSpread/computeEdge/computeSignal)
// and provides an AdjO/AdjD/Tempo matchup model that matches your written formula.
//
// Conventions:
// - "spread" is Vegas "home spread" convention:
//    home favored => negative number (e.g. -6.5)

import type { Team } from "@/data/teams";
export type Side = "HOME" | "AWAY" | "NONE";

// Assumes spreads are in "home spread" convention.
export function pickSideFromEdge(edge?: number): Side {
  if (edge === undefined || edge === 0) return "NONE";

  // If modelSpread > marketSpread (edge positive), model likes AWAY.
  // If modelSpread < marketSpread (edge negative), model likes HOME.
  return edge > 0 ? "AWAY" : "HOME";
}
export function computeModelSpread(
  homePR: number,
  awayPR: number,
  hca: number
) {
  // Expected home margin (positive => home better)
  const homeMargin = homePR + hca - awayPR;

  // Convert to "home spread" convention:
  // home favored => negative spread
  return round(-homeMargin);
}

export function computeEdge(modelSpread: number, vegasSpread?: number) {
  if (vegasSpread === undefined) return undefined;
  return round(modelSpread - vegasSpread);
}

export function computeSignal(edge?: number): "STRONG" | "LEAN" | "NONE" {
  if (edge === undefined) return "NONE";
  const a = Math.abs(edge);
  if (a >= 5) return "STRONG";
  if (a >= 3) return "LEAN";
  return "NONE";
}

// ------------------------------
// AdjO/AdjD/Tempo efficiency model
// ------------------------------

export type EfficiencyModelOut = {
  possessions: number;

  // per-100 outputs used for debugging/validation
  homePP100: number;
  awayPP100: number;

  homePts: number;
  awayPts: number;

  marginPer100: number;
  scaledMargin: number; // margin in points before HCA
  hcaUsed: number;
  homeMarginPts: number; // margin in points after HCA

  // "home spread" convention (home favored => negative)
  modelSpread: number;
  modelTotal: number;
};

// Optional: call this from your route to log a clean breakdown
export function getEfficiencyMathBreakdown(
  awayName: string,
  homeName: string,
  out: EfficiencyModelOut
) {
  return {
    matchup: `${awayName} @ ${homeName}`,
    step1_possessions: out.possessions,
    step2_EP: round(out.possessions / 100),
    step3_homePP100: out.homePP100,
    step3_awayPP100: out.awayPP100,
    step4_marginPer100: out.marginPer100,
    step5_scaledMargin: out.scaledMargin,
    step6_HCA: out.hcaUsed,
    step6_homeMarginPts: out.homeMarginPts,
    step7_modelSpread: out.modelSpread,
    modelTotal: out.modelTotal,
  };
}

export function computeEfficiencyModel(
  home: Team,
  away: Team,
  hca?: number
): EfficiencyModelOut | undefined {
  // Require torvik fields
  if (
    !isFiniteNum(home.adjO) ||
    !isFiniteNum(home.adjD) ||
    !isFiniteNum(home.tempo)
  )
    return undefined;
  if (
    !isFiniteNum(away.adjO) ||
    !isFiniteNum(away.adjD) ||
    !isFiniteNum(away.tempo)
  )
    return undefined;

  const HCA = isFiniteNum(hca) ? hca : isFiniteNum(home.hca) ? home.hca : 2;

  // --- Step 1: expected possessions ---
  const possessions = clamp(avg(home.tempo, away.tempo), 56, 78);

  // League baseline for efficiencies (Torvik AdjO/AdjD are centered ~100)
  const LEAGUE_BASE = 100;

  // --- Step 3: matchup PP100 using your intended baseline-adjust formula ---
  // Home scoring increases if opponent defense is worse than average (AdjD > 100)
  const homePP100 = home.adjO + (away.adjD - LEAGUE_BASE);
  const awayPP100 = away.adjO + (home.adjD - LEAGUE_BASE);

  // Convert per-100 to points given expected possessions
  const ep = possessions / 100;
  const homePts = homePP100 * ep;
  const awayPts = awayPP100 * ep;

  // Margin math
  const marginPer100 = homePP100 - awayPP100;
  const scaledMargin = marginPer100 * ep; // points before HCA
  const homeMarginPts = scaledMargin + HCA;

  // Convert to "home spread" convention
  const modelSpread = round(-homeMarginPts);

  // Total
  const modelTotal = round(clamp(homePts + awayPts, 95, 190));

  return {
    possessions: round(possessions),

    homePP100: round(homePP100),
    awayPP100: round(awayPP100),

    homePts: round(homePts),
    awayPts: round(awayPts),

    marginPer100: round(marginPer100),
    scaledMargin: round(scaledMargin),
    hcaUsed: round(HCA),
    homeMarginPts: round(homeMarginPts),

    modelSpread,
    modelTotal,
  };
}

// ------------------------------
// utils
// ------------------------------

function round(n: number) {
  return Math.round(n * 10) / 10;
}

function avg(a: number, b: number) {
  return (a + b) / 2;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
