// src/lib/model/matchupModel.ts
// Drop-in helper: uses Torvik AdjO/AdjD/Tempo to project spread + total.
// Assumptions:
// - adjO = points scored per 100 poss
// - adjD = points allowed per 100 poss
// - tempo = possessions per 40
//
// Model:
//   home_pp100 = avg(home_adjO, away_adjD)
//   away_pp100 = avg(away_adjO, home_adjD)
//   poss       = avg(home_tempo, away_tempo)
//   home_pts   = home_pp100/100 * poss
//   away_pts   = away_pp100/100 * poss
//   spread     = (home_pts - away_pts) + hca
//   total      = home_pts + away_pts

import type { Team } from "@/data/teams";

type MatchupModelOut = {
  possessions: number;
  homePts: number;
  awayPts: number;
  spread: number; // home - away (includes HCA)
  total: number;
};

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function avg(a: number, b: number) {
  return (a + b) / 2;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function computeMatchupSpreadAndTotal(
  home: Team,
  away: Team,
  opts?: {
    // override HCA (else uses home.hca, else 2)
    hca?: number;
    // reasonable guardrails (optional)
    clampPossessions?: [number, number]; // default [56, 78]
    clampTotal?: [number, number]; // default [95, 190]
    clampSpread?: [number, number]; // default [-35, 35]
  }
): MatchupModelOut {
  if (
    !isFiniteNum(home.adjO) ||
    !isFiniteNum(home.adjD) ||
    !isFiniteNum(home.tempo)
  ) {
    throw new Error(`Missing Torvik fields for home teamId="${home.teamId}"`);
  }
  if (
    !isFiniteNum(away.adjO) ||
    !isFiniteNum(away.adjD) ||
    !isFiniteNum(away.tempo)
  ) {
    throw new Error(`Missing Torvik fields for away teamId="${away.teamId}"`);
  }

  const hca = isFiniteNum(opts?.hca)
    ? opts!.hca
    : isFiniteNum(home.hca)
    ? home.hca
    : 2;

  // Possessions per game (simple blend)
  const possRaw = avg(home.tempo, away.tempo);

  const [pLo, pHi] = opts?.clampPossessions ?? [56, 78];
  const possessions = clamp(possRaw, pLo, pHi);

  // Expected efficiency vs opponent (simple blend)
  const homePP100 = avg(home.adjO, away.adjD);
  const awayPP100 = avg(away.adjO, home.adjD);

  const homePtsRaw = (homePP100 / 100) * possessions;
  const awayPtsRaw = (awayPP100 / 100) * possessions;

  const spreadRaw = homePtsRaw - awayPtsRaw + hca;
  const totalRaw = homePtsRaw + awayPtsRaw;

  const [sLo, sHi] = opts?.clampSpread ?? [-35, 35];
  const [tLo, tHi] = opts?.clampTotal ?? [95, 190];

  const spread = clamp(spreadRaw, sLo, sHi);
  const total = clamp(totalRaw, tLo, tHi);

  return {
    possessions,
    homePts: homePtsRaw,
    awayPts: awayPtsRaw,
    spread,
    total,
  };
}
