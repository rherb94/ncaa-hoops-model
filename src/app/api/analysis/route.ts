// src/app/api/analysis/route.ts
// Returns combined snapshot + results data for model performance analysis.
// Designed to be readable by humans and Claude alike.
//
// GET /api/analysis?date=YYYY-MM-DD          — single day
// GET /api/analysis?from=YYYY-MM-DD&to=...   — date range (max 30 days)
// GET /api/analysis?date=YYYY-MM-DD&fmt=text — plain text summary (paste-able for Claude)

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "src", "data");
const SNAP_DIR = path.join(DATA_DIR, "odds_opening");
const RES_DIR = path.join(DATA_DIR, "results");

function loadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  while (cur <= end && dates.length < 30) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

type SnapshotGame = {
  oddsEventId: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  opening: { book: string; homePoint: number; awayPoint: number } | null;
  model: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    rawModelSpread: number | null;
    modelSpread: number | null;
    edge: number | null;
    signal: string;
  } | null;
};

type ResultGame = {
  espnEventId: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  actualSpread: number | null; // home spread convention
  winner: "HOME" | "AWAY" | "TIE" | null;
};

function evaluatePick(
  signal: string,
  edge: number | null,
  openingHomePoint: number | null,
  actualSpread: number | null // home spread: neg = home won by abs(n)
): "WIN" | "LOSS" | "PUSH" | "NO_PICK" | "PENDING" {
  if (signal === "NONE" || edge === null) return "NO_PICK";
  if (actualSpread === null) return "PENDING";
  if (openingHomePoint === null) return "PENDING";

  // edge > 0 → model likes AWAY (model spread > market spread → home is overpriced)
  // edge < 0 → model likes HOME
  const pickSide: "HOME" | "AWAY" = edge < 0 ? "HOME" : "AWAY";
  const line = openingHomePoint; // home spread line we "bet against" or "with"

  // Did the home team cover?
  // actualSpread = -(homeScore - awayScore) in home-spread convention
  // e.g. home wins by 7: actualSpread = -7
  const margin = actualSpread - line; // positive = home covered, negative = away covered

  if (Math.abs(margin) < 0.01) return "PUSH";
  const homeCovered = margin < 0; // actualSpread < line means home did better than line

  if (pickSide === "HOME") return homeCovered ? "WIN" : "LOSS";
  return homeCovered ? "LOSS" : "WIN"; // picking AWAY
}

function analyzeDate(date: string) {
  const snap = loadJson<{ date: string; games: SnapshotGame[] }>(
    path.join(SNAP_DIR, `${date}.json`)
  );
  const res = loadJson<{ date: string; games: ResultGame[] }>(
    path.join(RES_DIR, `${date}.json`)
  );

  if (!snap) return null;

  // index results by ESPN team ID pair
  const resultByTeams = new Map<string, ResultGame>();
  for (const g of res?.games ?? []) {
    if (g.home_espnTeamId && g.away_espnTeamId) {
      resultByTeams.set(`${g.home_espnTeamId}|${g.away_espnTeamId}`, g);
    }
  }

  const games = snap.games.map((sg) => {
    const result =
      sg.home_espnTeamId && sg.away_espnTeamId
        ? resultByTeams.get(`${sg.home_espnTeamId}|${sg.away_espnTeamId}`) ?? null
        : null;

    const pickResult = evaluatePick(
      sg.model?.signal ?? "NONE",
      sg.model?.edge ?? null,
      sg.opening?.homePoint ?? null,
      result?.actualSpread ?? null
    );

    const pickSide =
      sg.model?.signal === "NONE" || !sg.model?.edge
        ? "NONE"
        : sg.model.edge < 0
        ? "HOME"
        : "AWAY";

    return {
      date,
      home_team: sg.home_team,
      away_team: sg.away_team,
      opening_spread: sg.opening?.homePoint ?? null, // home spread
      opening_book: sg.opening?.book ?? null,
      model_spread: sg.model?.modelSpread ?? null,
      edge: sg.model?.edge ?? null,
      signal: sg.model?.signal ?? "NONE",
      pick_side: pickSide,
      // result
      home_score: result?.homeScore ?? null,
      away_score: result?.awayScore ?? null,
      actual_spread: result?.actualSpread ?? null,
      winner: result?.winner ?? null,
      completed: result?.completed ?? false,
      // evaluation
      pick_result: pickResult,
    };
  });

  // aggregate stats
  const picks = games.filter((g) => g.signal !== "NONE");
  const decided = picks.filter((g) => g.pick_result === "WIN" || g.pick_result === "LOSS");
  const wins = decided.filter((g) => g.pick_result === "WIN").length;
  const strongPicks = picks.filter((g) => g.signal === "STRONG");
  const strongDecided = strongPicks.filter((g) => g.pick_result === "WIN" || g.pick_result === "LOSS");
  const strongWins = strongDecided.filter((g) => g.pick_result === "WIN").length;

  return {
    date,
    snapshot_available: true,
    results_available: !!res,
    total_games: games.length,
    picks_made: picks.length,
    strong_picks: strongPicks.length,
    lean_picks: picks.filter((g) => g.signal === "LEAN").length,
    record: decided.length > 0 ? `${wins}-${decided.length - wins}` : "pending",
    strong_record:
      strongDecided.length > 0
        ? `${strongWins}-${strongDecided.length - strongWins}`
        : "pending",
    win_pct: decided.length > 0 ? Math.round((wins / decided.length) * 100) : null,
    games,
  };
}

function toTextSummary(results: ReturnType<typeof analyzeDate>[]): string {
  const lines: string[] = ["NCAA BASKETBALL MODEL ANALYSIS", "=".repeat(50), ""];

  for (const day of results) {
    if (!day) continue;
    lines.push(`📅 ${day.date}`);
    lines.push(
      `   Games: ${day.total_games} | Picks: ${day.picks_made} (${day.strong_picks} STRONG, ${day.lean_picks} LEAN)`
    );
    lines.push(`   Record: ${day.record} | Strong: ${day.strong_record}`);
    if (day.win_pct !== null) lines.push(`   Win%: ${day.win_pct}%`);
    lines.push("");

    for (const g of day.games) {
      const scoreStr =
        g.home_score !== null && g.away_score !== null
          ? `${g.away_score}-${g.home_score}`
          : "TBD";
      const pickStr =
        g.signal === "NONE"
          ? "NO PICK"
          : `${g.signal} ${g.pick_side} (edge: ${g.edge?.toFixed(1)})`;
      const resultStr =
        g.pick_result === "NO_PICK"
          ? ""
          : g.pick_result === "PENDING"
          ? " → PENDING"
          : ` → ${g.pick_result}`;

      lines.push(
        `   ${g.away_team} @ ${g.home_team}` +
          ` | Line: ${g.opening_spread ?? "N/A"} Model: ${g.model_spread ?? "N/A"}` +
          ` | ${pickStr}${resultStr}` +
          (scoreStr !== "TBD" ? ` | Score: ${scoreStr}` : "")
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fmt = url.searchParams.get("fmt"); // "text" for paste-able summary

  // resolve date range
  const dateSingle = url.searchParams.get("date");
  const dateFrom = url.searchParams.get("from");
  const dateTo = url.searchParams.get("to");

  let dates: string[];
  if (dateSingle) {
    dates = [dateSingle];
  } else if (dateFrom) {
    const to = dateTo ?? dateSingle ?? new Date().toISOString().slice(0, 10);
    dates = datesInRange(dateFrom, to);
  } else {
    // default: last 7 days with available snapshots
    const available = fs.existsSync(SNAP_DIR)
      ? fs.readdirSync(SNAP_DIR)
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.replace(".json", ""))
          .sort()
          .slice(-7)
      : [];
    dates = available;
  }

  if (dates.length === 0) {
    return NextResponse.json({ error: "No snapshot data found" }, { status: 404 });
  }

  const results = dates.map(analyzeDate).filter(Boolean);

  if (fmt === "text") {
    return new Response(toTextSummary(results as any), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // aggregate across all dates
  const allDecided = results.flatMap((r) =>
    (r?.games ?? []).filter(
      (g) => g.pick_result === "WIN" || g.pick_result === "LOSS"
    )
  );
  const totalWins = allDecided.filter((g) => g.pick_result === "WIN").length;
  const allPicks = results.flatMap((r) =>
    (r?.games ?? []).filter((g) => g.signal !== "NONE")
  );

  return NextResponse.json({
    dates_analyzed: dates,
    summary: {
      total_picks: allPicks.length,
      decided: allDecided.length,
      wins: totalWins,
      losses: allDecided.length - totalWins,
      win_pct: allDecided.length > 0 ? Math.round((totalWins / allDecided.length) * 100) : null,
    },
    by_date: results,
  });
}
