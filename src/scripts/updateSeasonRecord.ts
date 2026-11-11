// src/scripts/updateSeasonRecord.ts
// Writes src/data/<league>/seasonRecord.json — the model's stored record for
// the current season. Runs nightly after results are fetched, so the record is
// kept in the repo's history as well as shown on the site.
//
// Usage:
//   LEAGUE=ncaam npx tsx src/scripts/updateSeasonRecord.ts

import fs from "node:fs";
import path from "node:path";
import {
  DATA_DIR,
  allAvailableDates,
  analyzeDate,
  fetchIntradayPicks,
  summarize,
} from "@/lib/analysis";
import type { DayAnalysis } from "@/lib/analysis";
import { getLeague } from "@/lib/leagues";
import { filterToCurrentSeason, seasonStartDate } from "@/lib/season";
import { isPlay } from "@/lib/signal";
import { round2 } from "@/lib/grading";

const LEAGUE = process.env.LEAGUE || "ncaam";

async function main() {
  const league = getLeague(LEAGUE);
  const seasonStart = seasonStartDate(league.id);
  const dates = filterToCurrentSeason(allAvailableDates(league.id), league.id);

  // Intraday picks live in the DB; included when it's reachable so this file
  // matches what the Results page shows.
  const intraday = await fetchIntradayPicks(dates, league.id);

  const days = dates
    .map((d) => analyzeDate(d, league.id, undefined, intraday.get(d)))
    .filter(Boolean) as DayAnalysis[];

  // Running totals by day, for charting the season later.
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  const daily = days.map((d) => {
    const plays = d.games.filter((g) => isPlay(g.signal));
    const w = plays.filter((g) => g.pick_result === "WIN").length;
    const l = plays.filter((g) => g.pick_result === "LOSS").length;
    const p = plays.filter((g) => g.pick_result === "PUSH").length;
    const u = plays.reduce((sum, g) => sum + (g.units ?? 0), 0);
    wins += w;
    losses += l;
    pushes += p;
    units += u;
    return {
      date: d.date,
      plays: plays.length,
      wins: w,
      losses: l,
      pushes: p,
      units: round2(u),
      cumulative: { wins, losses, pushes, units: round2(units) },
    };
  });

  const out = {
    league: league.id,
    season_start: seasonStart,
    updated_at: new Date().toISOString(),
    days_tracked: days.length,
    first_date: days[0]?.date ?? null,
    last_date: days[days.length - 1]?.date ?? null,
    ...summarize(days),
    daily,
  };

  const file = path.join(DATA_DIR, league.id, "seasonRecord.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf-8");

  const p = out.plays;
  console.log(
    `✅ ${league.shortName} season record: ${p.wins}-${p.losses}${p.pushes ? `-${p.pushes}` : ""} ` +
      `(${p.units >= 0 ? "+" : ""}${p.units}u) over ${days.length} day(s) → ${file}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Failed:", e);
    process.exit(1);
  });
