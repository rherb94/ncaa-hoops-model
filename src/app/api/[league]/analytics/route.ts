// src/app/api/[league]/analytics/route.ts
// Cross-date analytics: spread bias, team frequency, conference breakdown.
// All computed from existing JSON files — no database required.
//
// GET /api/[league]/analytics               → all live dates (excludes backfilled)
// GET /api/[league]/analytics?backfilled=1  → include backfilled dates
// GET /api/[league]/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getLeague } from "@/lib/leagues";
import { loadTeams } from "@/data/teams";
import type { LeagueId } from "@/lib/leagues";

const DATA_DIR = path.join(process.cwd(), "src", "data");

// First date with a real automated live snapshot (matches analysis/route.ts)
const LIVE_FROM = "2026-03-02";

// ---- types ----------------------------------------------------------------

type SnapshotGame = {
  oddsEventId: string;
  home_team: string;
  away_team: string;
  home_espnTeamId?: string | null;
  away_espnTeamId?: string | null;
  opening: { homePoint: number; awayPoint: number } | null;
  model: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    modelSpread: number | null;
    edge: number | null;
    signal: string;
  } | null;
};

type ResultGame = {
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  completed: boolean;
  actualSpread: number | null;
};

type ClosingLineGame = {
  oddsEventId: string;
  homePoint: number | null;
};

// ---- helpers ---------------------------------------------------------------

function loadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function allAvailableDates(leagueId: string): string[] {
  const d = path.join(DATA_DIR, leagueId, "odds_opening");
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  while (cur <= end && dates.length < 200) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function evaluatePick(
  signal: string,
  edge: number | null,
  openingHomePoint: number | null,
  actualSpread: number | null
): "WIN" | "LOSS" | "PUSH" | "NO_PICK" | "PENDING" {
  if (signal === "NONE" || edge === null) return "NO_PICK";
  if (actualSpread === null || openingHomePoint === null) return "PENDING";
  const pickSide = edge < 0 ? "HOME" : "AWAY";
  const margin = actualSpread - openingHomePoint;
  if (Math.abs(margin) < 0.01) return "PUSH";
  const homeCovered = margin < 0;
  if (pickSide === "HOME") return homeCovered ? "WIN" : "LOSS";
  return homeCovered ? "LOSS" : "WIN";
}

function computeClv(
  openingHomePoint: number | null,
  closingHomePoint: number | null,
  edge: number | null
): number | null {
  if (openingHomePoint === null || closingHomePoint === null || !edge) return null;
  const pickSide = edge < 0 ? "HOME" : "AWAY";
  const raw = openingHomePoint - closingHomePoint;
  return pickSide === "HOME" ? raw : -raw;
}

// Bucket the pick line from the picked team's perspective.
// pickLine > 0 means we're picking an underdog, < 0 means picking a favorite.
function spreadBucketKey(openingHomePoint: number, pickSide: "HOME" | "AWAY"): string {
  const pickLine = pickSide === "HOME" ? openingHomePoint : -openingHomePoint;
  if (pickLine <= -7) return "big_fav";
  if (pickLine <= -3) return "fav";
  if (pickLine < 3)   return "pick";
  if (pickLine < 7)   return "dog";
  return "big_dog";
}

const SPREAD_BUCKET_META: Record<string, { label: string; range: string; order: number }> = {
  big_fav: { label: "Big Favorite", range: "< −7",      order: 0 },
  fav:     { label: "Favorite",     range: "−7 to −3",  order: 1 },
  pick:    { label: "Pick'em",      range: "−3 to +3",  order: 2 },
  dog:     { label: "Underdog",     range: "+3 to +7",  order: 3 },
  big_dog: { label: "Big Dog",      range: "> +7",      order: 4 },
};

// ---- accumulators ----------------------------------------------------------

type SpreadBucketAcc = {
  games: number;
  wins: number;
  losses: number;
  pushes: number;
  clv_sum: number;
  clv_count: number;
  edge_sum: number;
  edge_count: number;
};

type TeamAcc = {
  team_name: string;
  torvik_id: string | null;
  appearances: number;
  pick_for: number;        // games where model picked THIS team to cover
  wins: number;
  losses: number;
  pushes: number;
  edge_sum: number;
  edge_count: number;
  clv_sum: number;
  clv_count: number;
};

type ConferenceAcc = {
  conference: string;
  pick_games: number;
  wins: number;
  losses: number;
  model_error_sum: number;
  model_error_count: number;
};

// ---- main computation ------------------------------------------------------

function computeAnalytics(dates: string[], leagueId: string) {
  const snapDir  = path.join(DATA_DIR, leagueId, "odds_opening");
  const resDir   = path.join(DATA_DIR, leagueId, "results");
  const closeDir = path.join(DATA_DIR, leagueId, "closing_lines");

  // Load team conference map from teams.csv
  const teamsMap = loadTeams(leagueId as LeagueId);
  const confByTorvikId = new Map<string, string>();
  for (const [id, t] of teamsMap.entries()) {
    if (t.conference) confByTorvikId.set(id, t.conference);
  }

  const spreadBuckets = new Map<string, SpreadBucketAcc>();
  const teamAccs      = new Map<string, TeamAcc>();
  const confAccs      = new Map<string, ConferenceAcc>();

  for (const date of dates) {
    const snap = loadJson<{ games: SnapshotGame[] }>(
      path.join(snapDir, `${date}.json`)
    );
    if (!snap) continue;

    const resFile = loadJson<{ games: ResultGame[] }>(
      path.join(resDir, `${date}.json`)
    );
    const closeFile = loadJson<{ games: ClosingLineGame[] }>(
      path.join(closeDir, `${date}.json`)
    );

    // Index results by ESPN team ID pair
    const resultByTeams = new Map<string, ResultGame>();
    for (const g of resFile?.games ?? []) {
      if (g.home_espnTeamId && g.away_espnTeamId) {
        resultByTeams.set(`${g.home_espnTeamId}|${g.away_espnTeamId}`, g);
      }
    }

    // Index closing lines by oddsEventId
    const closingByEventId = new Map<string, ClosingLineGame>();
    for (const g of closeFile?.games ?? []) {
      if (g.oddsEventId) closingByEventId.set(g.oddsEventId, g);
    }

    for (const sg of snap.games) {
      const result =
        sg.home_espnTeamId && sg.away_espnTeamId
          ? resultByTeams.get(`${sg.home_espnTeamId}|${sg.away_espnTeamId}`) ?? null
          : null;

      const closing = sg.oddsEventId
        ? closingByEventId.get(sg.oddsEventId) ?? null
        : null;

      const signal        = sg.model?.signal ?? "NONE";
      const edge          = sg.model?.edge ?? null;
      const openingPt     = sg.opening?.homePoint ?? null;
      const actualSpread  = result?.actualSpread ?? null;
      const closingPt     = closing?.homePoint ?? null;
      const modelSpread   = sg.model?.modelSpread ?? null;

      const pickResult = evaluatePick(signal, edge, openingPt, actualSpread);
      const clv        = computeClv(openingPt, closingPt, edge);

      const hasPick    = pickResult !== "NO_PICK";
      const isDecided  = pickResult === "WIN" || pickResult === "LOSS" || pickResult === "PUSH";
      const pickSide: "HOME" | "AWAY" | null =
        edge !== null && edge !== 0 ? (edge < 0 ? "HOME" : "AWAY") : null;

      const homeTorvikId = sg.model?.homeTeamId ?? null;
      const awayTorvikId = sg.model?.awayTeamId ?? null;
      const homeConf     = homeTorvikId ? confByTorvikId.get(homeTorvikId) : undefined;
      const awayConf     = awayTorvikId ? confByTorvikId.get(awayTorvikId) : undefined;

      // ---- spread bucket (picks only) ------------------------------------
      if (hasPick && openingPt !== null && pickSide) {
        const key = spreadBucketKey(openingPt, pickSide);
        if (!spreadBuckets.has(key)) {
          spreadBuckets.set(key, {
            games: 0, wins: 0, losses: 0, pushes: 0,
            clv_sum: 0, clv_count: 0, edge_sum: 0, edge_count: 0,
          });
        }
        const b = spreadBuckets.get(key)!;
        b.games++;
        if (isDecided) {
          if (pickResult === "WIN")   b.wins++;
          if (pickResult === "LOSS")  b.losses++;
          if (pickResult === "PUSH")  b.pushes++;
        }
        if (clv !== null)  { b.clv_sum  += clv;  b.clv_count++; }
        if (edge !== null) { b.edge_sum += Math.abs(edge); b.edge_count++; }
      }

      // ---- by team -------------------------------------------------------
      function accTeam(
        teamName: string,
        torvikId: string | null,
        side: "HOME" | "AWAY"
      ) {
        const key = torvikId ?? teamName;
        if (!teamAccs.has(key)) {
          teamAccs.set(key, {
            team_name: teamName,
            torvik_id: torvikId,
            appearances: 0,
            pick_for: 0,
            wins: 0, losses: 0, pushes: 0,
            edge_sum: 0, edge_count: 0,
            clv_sum: 0, clv_count: 0,
          });
        }
        const acc = teamAccs.get(key)!;
        acc.appearances++;

        // Did we pick THIS team to cover?
        const pickedThisTeam = hasPick && pickSide === side;
        if (pickedThisTeam) {
          acc.pick_for++;
          if (isDecided) {
            if (pickResult === "WIN")  acc.wins++;
            if (pickResult === "LOSS") acc.losses++;
            if (pickResult === "PUSH") acc.pushes++;
          }
          if (edge !== null) { acc.edge_sum += Math.abs(edge); acc.edge_count++; }
          if (clv !== null)  { acc.clv_sum  += clv;  acc.clv_count++; }
        }
      }

      accTeam(sg.home_team, homeTorvikId, "HOME");
      accTeam(sg.away_team, awayTorvikId, "AWAY");

      // ---- by conference (picks only, one entry per conf per game) -------
      if (hasPick && isDecided) {
        // Credit the conference of the PICKED team
        const pickedConf = pickSide === "HOME" ? homeConf : awayConf;
        const conf = pickedConf ?? "Unknown";

        if (!confAccs.has(conf)) {
          confAccs.set(conf, {
            conference: conf,
            pick_games: 0, wins: 0, losses: 0,
            model_error_sum: 0, model_error_count: 0,
          });
        }
        const c = confAccs.get(conf)!;
        c.pick_games++;
        if (pickResult === "WIN")  c.wins++;
        if (pickResult === "LOSS") c.losses++;

        if (modelSpread !== null && actualSpread !== null) {
          c.model_error_sum   += Math.abs(actualSpread - modelSpread);
          c.model_error_count++;
        }
      }
    }
  }

  // ---- finalise by_spread ------------------------------------------------
  const by_spread = Object.entries(SPREAD_BUCKET_META)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, meta]) => {
      const b = spreadBuckets.get(key) ?? {
        games: 0, wins: 0, losses: 0, pushes: 0,
        clv_sum: 0, clv_count: 0, edge_sum: 0, edge_count: 0,
      };
      const decided = b.wins + b.losses;
      return {
        key,
        label: meta.label,
        range: meta.range,
        games: b.games,
        wins: b.wins,
        losses: b.losses,
        pushes: b.pushes,
        win_pct: decided > 0 ? Math.round((b.wins / decided) * 100) : null,
        avg_clv:  b.clv_count  > 0 ? Math.round((b.clv_sum  / b.clv_count)  * 10) / 10 : null,
        avg_edge: b.edge_count > 0 ? Math.round((b.edge_sum / b.edge_count) * 10) / 10 : null,
      };
    });

  // ---- finalise by_team --------------------------------------------------
  const by_team = [...teamAccs.values()]
    .filter((t) => t.appearances > 0)
    .sort((a, b) => b.pick_for - a.pick_for || b.appearances - a.appearances)
    .map((t) => {
      const decided = t.wins + t.losses;
      return {
        team_name:    t.team_name,
        torvik_id:    t.torvik_id,
        conference:   t.torvik_id ? confByTorvikId.get(t.torvik_id) ?? null : null,
        appearances:  t.appearances,
        pick_for:     t.pick_for,
        wins:         t.wins,
        losses:       t.losses,
        pushes:       t.pushes,
        win_pct:      decided > 0 ? Math.round((t.wins / decided) * 100) : null,
        avg_edge:     t.edge_count > 0
          ? Math.round((t.edge_sum / t.edge_count) * 10) / 10 : null,
        avg_clv:      t.clv_count > 0
          ? Math.round((t.clv_sum  / t.clv_count)  * 10) / 10 : null,
      };
    });

  // ---- finalise by_conference --------------------------------------------
  const by_conference = [...confAccs.values()]
    .filter((c) => c.pick_games > 0)
    .sort((a, b) => b.pick_games - a.pick_games)
    .map((c) => ({
      conference:       c.conference,
      pick_games:       c.pick_games,
      wins:             c.wins,
      losses:           c.losses,
      win_pct:          c.wins + c.losses > 0
        ? Math.round((c.wins / (c.wins + c.losses)) * 100) : null,
      avg_model_error:  c.model_error_count > 0
        ? Math.round((c.model_error_sum / c.model_error_count) * 10) / 10 : null,
    }));

  return { by_spread, by_team, by_conference };
}

// ---- route handler ---------------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league: leagueId } = await params;

  let leagueCfg;
  try {
    leagueCfg = getLeague(leagueId);
  } catch {
    return NextResponse.json({ error: `Unknown league: ${leagueId}` }, { status: 400 });
  }

  const url            = new URL(req.url);
  const includeBackfilled = url.searchParams.get("backfilled") === "1";
  const dateFrom       = url.searchParams.get("from");
  const dateTo         = url.searchParams.get("to");

  let dates: string[];
  if (dateFrom) {
    const to = dateTo ?? new Date().toISOString().slice(0, 10);
    dates = datesInRange(dateFrom, to);
  } else {
    dates = allAvailableDates(leagueCfg.id);
  }

  if (!includeBackfilled) {
    dates = dates.filter((d) => d >= LIVE_FROM);
  }

  if (dates.length === 0) {
    return NextResponse.json({ error: "No data found" }, { status: 404 });
  }

  const analytics = computeAnalytics(dates, leagueCfg.id);

  return NextResponse.json({
    league: leagueCfg.id,
    dates_analyzed: dates.length,
    date_range: { from: dates[0], to: dates[dates.length - 1] },
    backfilled_included: includeBackfilled,
    ...analytics,
  });
}
