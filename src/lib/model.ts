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
// Football (CFB) efficiency model
// ------------------------------
//
// Structurally mirrors computeEfficiencyModel above, with "plays" standing in
// for basketball's "possessions" and SP+ offense/defense ratings standing in
// for AdjO/AdjD. Team fields are repurposed (see src/db/schema.ts comment):
//   adjO   = SP+ offense.rating (points/game at the team's own pace)
//   adjD   = SP+ defense.rating (points/game allowed at the team's own pace)
//   tempo  = plays per game (that team's own offensive play volume)
//
// Constants below (LEAGUE_BASE_PP, clamp ranges) were derived empirically
// from live 2025 CFBD data (see updateTeamsFromCfbd.ts research spike):
//   offense pts/play: mean 0.4016  |  defense pts/play allowed: mean 0.3927
//   plays/game: mean 67.5, observed range ~58-79
// LEAGUE_BASE_PP uses the average of the two — recalibrate once a full
// season of results is available to backtest against.

export type FootballEfficiencyModelOut = {
  plays: number;

  homePPPlay: number;
  awayPPPlay: number;

  homePts: number;
  awayPts: number;

  marginPerPlay: number;
  scaledMargin: number; // margin in points before HCA
  hcaUsed: number;
  homeMarginPts: number; // margin in points after HCA

  // "home spread" convention (home favored => negative)
  modelSpread: number;
  modelTotal: number;
};

const CFB_LEAGUE_BASE_PP = 0.397;
const CFB_DEFAULT_HCA = 2.3; // CFB HCA commonly cited ~2-3 pts, lower/more variable than basketball's ~3-4

// Per-play rates live in ~0.3-0.5 range — round()'s 1-decimal precision would
// destroy nearly all signal, so these fields get 3 decimals instead.
function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function computeFootballEfficiencyModel(
  home: Team,
  away: Team,
  hca?: number
): FootballEfficiencyModelOut | undefined {
  // Require plays-per-game + SP+ offense/defense fields
  if (
    !isFiniteNum(home.adjO) ||
    !isFiniteNum(home.adjD) ||
    !isFiniteNum(home.tempo) ||
    home.tempo <= 0
  )
    return undefined;
  if (
    !isFiniteNum(away.adjO) ||
    !isFiniteNum(away.adjD) ||
    !isFiniteNum(away.tempo) ||
    away.tempo <= 0
  )
    return undefined;

  const HCA = isFiniteNum(hca) ? hca : isFiniteNum(home.hca) ? home.hca : CFB_DEFAULT_HCA;

  // --- Step 1: convert each team's own season output to a pace-free rate ---
  const homeOffPPPlay = home.adjO / home.tempo;
  const homeDefPPPlay = home.adjD / home.tempo;
  const awayOffPPPlay = away.adjO / away.tempo;
  const awayDefPPPlay = away.adjD / away.tempo;

  // --- Step 2: expected plays for THIS matchup (pace blend, clamped to observed FBS range) ---
  const plays = clamp(avg(home.tempo, away.tempo), 55, 85);

  // --- Step 3: matchup-adjusted points-per-play ---
  const homePPPlay = homeOffPPPlay + (awayDefPPPlay - CFB_LEAGUE_BASE_PP);
  const awayPPPlay = awayOffPPPlay + (homeDefPPPlay - CFB_LEAGUE_BASE_PP);

  const homePts = homePPPlay * plays;
  const awayPts = awayPPPlay * plays;

  // Margin math
  const marginPerPlay = homePPPlay - awayPPPlay;
  const scaledMargin = marginPerPlay * plays; // points before HCA
  const homeMarginPts = scaledMargin + HCA;

  // Convert to "home spread" convention
  const modelSpread = round(-homeMarginPts);

  // Total — CFB has much higher variance than basketball, clamp is wide
  const modelTotal = round(clamp(homePts + awayPts, 24, 90));

  return {
    plays: round(plays),

    homePPPlay: round3(homePPPlay),
    awayPPPlay: round3(awayPPPlay),

    homePts: round(homePts),
    awayPts: round(awayPts),

    marginPerPlay: round3(marginPerPlay),
    scaledMargin: round(scaledMargin),
    hcaUsed: round(HCA),
    homeMarginPts: round(homeMarginPts),

    modelSpread,
    modelTotal,
  };
}

// ------------------------------
// Sport dispatcher
// ------------------------------
//
// computeEfficiencyModel (basketball) and computeFootballEfficiencyModel both
// require Team.adjO/adjD/tempo to be present — but those fields are repurposed
// per-sport (see src/db/schema.ts), so calling the wrong one for a league does
// NOT return undefined, it silently runs the wrong formula on the data (e.g.
// basketball's ~100-centered PP100 math on football's ~0.4-scale SP+ ratings).
// Every call site that runs the efficiency model on a Team pair MUST go
// through this dispatcher rather than calling either function directly.
export function computeAnyEfficiencyModel(
  leagueId: LeagueId,
  home: Team,
  away: Team,
  hca?: number
): { modelSpread: number; modelTotal: number } | undefined {
  if (leagueId === "cfb") return computeFootballEfficiencyModel(home, away, hca);
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
