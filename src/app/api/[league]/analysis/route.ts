// src/app/api/analysis/route.ts
// Returns combined snapshot + results data for model performance analysis.
// Designed to be readable by humans and Claude alike.
//
// GET /api/analysis?date=YYYY-MM-DD          — single day
// GET /api/analysis?from=YYYY-MM-DD&to=...   — date range (max 30 days)
// GET /api/analysis?date=YYYY-MM-DD&fmt=text — plain text summary (paste-able for Claude)
// Ranges and ?all=1 cover the current season only; add &season=all for every season.

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getLeague } from "@/lib/leagues";
import { isPlay } from "@/lib/signal";
import { filterToCurrentSeason, seasonStartDate } from "@/lib/season";
import {
  DATA_DIR,
  allAvailableDates,
  analyzeDate,
  datesInRange,
  fetchIntradayPicks,
  fetchLiveResults,
  summarize,
  todayET,
  yesterdayET,
} from "@/lib/analysis";
import type { DayAnalysis, ResultGame } from "@/lib/analysis";


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
        !isPlay(g.signal)
          ? g.signal === "CAUTION" ? `CAUTION, not a play (edge: ${g.edge?.toFixed(1)})` : "NO PICK"
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league: leagueId } = await params;

  // Validate league — throws if unknown, which Next.js will surface as 500.
  // Use try/catch so we can return a proper 400 instead.
  let leagueCfg;
  try {
    leagueCfg = getLeague(leagueId);
  } catch {
    return NextResponse.json({ error: `Unknown league: ${leagueId}` }, { status: 400 });
  }

  const url = new URL(req.url);
  const fmt = url.searchParams.get("fmt"); // "text" for paste-able summary

  // resolve date range
  const dateSingle = url.searchParams.get("date");
  const dateFrom = url.searchParams.get("from");
  const dateTo = url.searchParams.get("to");
  const allFlag = url.searchParams.get("all"); // ?all=1 → every available snapshot

  let dates: string[];
  if (allFlag === "1") {
    dates = allAvailableDates(leagueCfg.id);
  } else if (dateSingle) {
    dates = [dateSingle];
  } else if (dateFrom) {
    const to = dateTo ?? new Date().toISOString().slice(0, 10);
    dates = datesInRange(dateFrom, to);
  } else {
    // default: last 7 days with available snapshots
    dates = allAvailableDates(leagueCfg.id).slice(-7);
  }

  // Performance is tracked per season: anything before the current season's
  // start is left out unless ?season=all. A single explicit ?date= is honoured
  // as-is so an old day can still be pulled up directly.
  const seasonParam = url.searchParams.get("season");
  if (!dateSingle) {
    dates = filterToCurrentSeason(dates, leagueCfg.id, seasonParam);
  }

  if (dates.length === 0) {
    if (dateSingle) {
      return NextResponse.json({ error: "No snapshot data found" }, { status: 404 });
    }
    // New season with nothing tracked yet — an empty record, not an error.
    if (fmt === "text") {
      return new Response("No games tracked yet this season.\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.json({
      dates_analyzed: [],
      season_start: seasonStartDate(leagueCfg.id),
      summary: summarize([]),
      by_date: [],
    });
  }

  // For dates within the last 2 days that have no results file yet, fetch live
  // scores from ESPN so the results page updates throughout the day.
  const resDir = path.join(DATA_DIR, leagueCfg.id, "results");
  const today     = todayET();
  const yesterday = yesterdayET();
  const datesNeedingLive = dates.filter(
    (d) =>
      (d === today || d === yesterday) &&
      !fs.existsSync(path.join(resDir, `${d}.json`))
  );

  const liveResultsMap = new Map<string, ResultGame[]>();
  if (datesNeedingLive.length > 0) {
    await Promise.all(
      datesNeedingLive.map(async (d) => {
        const live = await fetchLiveResults(d, leagueCfg.id);
        if (live.length > 0) liveResultsMap.set(d, live);
      })
    );
  }

  // Fetch intraday picks from DB (graceful fallback if DB unavailable)
  const intradayPicksMap = await fetchIntradayPicks(dates, leagueCfg.id);

  const results = dates
    .map((d) => analyzeDate(d, leagueCfg.id, liveResultsMap.get(d), intradayPicksMap.get(d)))
    .filter(Boolean);

  if (fmt === "text") {
    return new Response(toTextSummary(results as any), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.json({
    dates_analyzed: dates,
    season_start: seasonParam === "all" ? null : seasonStartDate(leagueCfg.id),
    summary: summarize(results as DayAnalysis[]),
    by_date: results,
  });
}
