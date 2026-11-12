// src/lib/model.ts
// Drop-in replacement.
// Keeps your existing API (computeModelSpread/computeEdge/computeSignal)
// and provides an AdjO/AdjD/Tempo matchup model that matches your written formula.
//
// Conventions:
// - "spread" is Vegas "home spread" convention:
//    home favored => negative number (e.g. -6.5)

import type { Team } from "@/data/teams";
import type { LeagueId } from "@/lib/leagues";
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

// Signal thresholds (NONE / LEAN / STRONG / CAUTION) live in ./signal so client
// components can share them.
export { computeSignal, isPlay, cautionNote } from "./signal";

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
// Football (CFB) model — SP+
// ------------------------------
//
// Team fields for cfb (see updateTeamsFromCfbd.ts):
//   powerRating = SP+ overall (offense − defense + special teams), points vs an
//                 average team on a neutral field
//   adjO / adjD = SP+ offense / defense: points scored / allowed per game
//                 against an average opponent
//   tempo       = plays per game (shown on the Teams page; not used here)
//
// SP+ is already opponent- and pace-adjusted, so it is used directly:
//   spread = −(SP+ home − SP+ away + home field)
//   total  = (home off + away def − avg def) + (away off + home def − avg def)
//          with the league averages folded into CFB_AVG_GAME_POINTS.
//
// This replaced a per-play conversion (rating ÷ own plays × blended plays)
// that differed from the plain SP+ difference by under a point on average,
// left out special teams, and was slightly worse on both spread and total
// against this season's results.

// Mean SP+ offense + mean SP+ defense across FBS (2026 season ≈ 26.7 + 25.9).
// SP+ is normalised, so this is stable year to year.
export const CFB_AVG_GAME_POINTS = 52.5;

// Points of home-field advantage. Provisional: home teams beat the SP+
// difference by ~3.3 points in 2026 games through mid-November (in-sample,
// neutral sites included). Revisit with a no-hindsight backtest.
export const CFB_DEFAULT_HCA = 3.0;

export type FootballModelOut = {
  homeRating: number;
  awayRating: number;
  hcaUsed: number;
  /** Expected home margin in points (positive = home better). */
  homeMarginPts: number;
  homePts?: number;
  awayPts?: number;
  /** "home spread" convention (home favored ⇒ negative). */
  modelSpread: number;
  /** Undefined when offense/defense ratings are missing. */
  modelTotal?: number;
};

export function computeFootballModel(
  home: Team,
  away: Team,
  hca?: number
): FootballModelOut | undefined {
  if (!isFiniteNum(home.powerRating) || !isFiniteNum(away.powerRating)) return undefined;

  const HCA = isFiniteNum(hca) ? hca : isFiniteNum(home.hca) ? home.hca : CFB_DEFAULT_HCA;
  const homeMarginPts = home.powerRating - away.powerRating + HCA;

  let homePts: number | undefined;
  let awayPts: number | undefined;
  let modelTotal: number | undefined;
  if (
    isFiniteNum(home.adjO) && isFiniteNum(home.adjD) &&
    isFiniteNum(away.adjO) && isFiniteNum(away.adjD)
  ) {
    const rawTotal = home.adjO + away.adjD + away.adjO + home.adjD - CFB_AVG_GAME_POINTS;
    modelTotal = round(clamp(rawTotal, 20, 100));
    // Split the total by the expected margin so the two scores agree with both.
    homePts = round(modelTotal / 2 + homeMarginPts / 2);
    awayPts = round(modelTotal / 2 - homeMarginPts / 2);
  }

  return {
    homeRating: home.powerRating,
    awayRating: away.powerRating,
    hcaUsed: round(HCA),
    homeMarginPts: round(homeMarginPts),
    homePts,
    awayPts,
    modelSpread: round(-homeMarginPts),
    modelTotal,
  };
}

// ------------------------------
// Sport dispatcher
// ------------------------------
//
// Team.adjO/adjD/powerRating mean different things per sport (Torvik
// efficiencies for basketball, SP+ points for football), so calling the wrong
// model for a league silently produces nonsense rather than undefined.
// Every call site that runs the efficiency model on a Team pair MUST go
// through this dispatcher rather than calling either function directly.
export function computeAnyEfficiencyModel(
  leagueId: LeagueId,
  home: Team,
  away: Team,
  hca?: number
): { modelSpread: number; modelTotal?: number } | undefined {
  if (leagueId === "cfb") return computeFootballModel(home, away, hca);
  return computeEfficiencyModel(home, away, hca);
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
