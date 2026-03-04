// src/scripts/fetchGameResults.ts
// Fetches final scores from ESPN's public scoreboard API and saves to
// src/data/${LEAGUE}/results/YYYY-MM-DD.json. Run after games finish (midnight ET).
import fs from "node:fs";
import path from "node:path";
import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";

const LEAGUE = process.env.LEAGUE ?? "ncaam";

// Date to fetch results for (YYYY-MM-DD). Default = yesterday in ET.
// Use || so empty string from workflow_dispatch falls back to default.
const DATE =
  process.env.DATE ||
  (() => {
    // "yesterday" in ET = subtract 1 day then format in ET
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
      .format(d)
      .slice(0, 10);
  })();

const ESPN_DATE = DATE.replace(/-/g, ""); // YYYYMMDD

// Games that tip off after ~7pm ET have a UTC commence_time of the NEXT calendar
// day. ESPN's scoreboard API uses UTC dates, so we must also query the next UTC
// day to capture those late games (e.g. 7:30pm ET = 00:30 UTC next day).
const ESPN_DATE_NEXT = (() => {
  const d = new Date(`${DATE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
})();

// ET date window: midnight ET → midnight ET next day.
// Midnight ET = 05:00 UTC in winter (EST) / 04:00 UTC during DST.
// 05:00 UTC is safe — no NCAAB games tip off between midnight and 1am ET.
const DAY_START_UTC = new Date(`${DATE}T05:00:00Z`);
const DAY_END_UTC   = new Date(DAY_START_UTC.getTime() + 24 * 60 * 60 * 1000);

function espnUrl(dateStr: string) {
  // groups=50 = NCAA Division I — without this ESPN only returns a small
  // "featured" subset of games, not the full D1 slate.
  const leagueCfg = LEAGUES[LEAGUE as LeagueId];
  const espnSport = leagueCfg?.espnSport ?? "mens-college-basketball";
  const espnGroupId = leagueCfg?.espnGroupId ?? "50";
  return (
    `https://site.api.espn.com/apis/site/v2/sports/basketball` +
    `/${espnSport}/scoreboard?dates=${dateStr}&groups=${espnGroupId}&limit=200`
  );
}

const OUT_DIR = path.join(process.cwd(), "src", "data", LEAGUE, "results");
const OUT_FILE = path.join(OUT_DIR, `${DATE}.json`);

function saveJson(p: string, obj: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

type EspnCompetitor = {
  id: string;
  homeAway: "home" | "away";
  score?: string;
  team: { id: string; displayName: string; shortDisplayName: string };
};

type EspnEvent = {
  id: string;
  date: string; // ISO UTC
  name: string;
  status: { type: { completed: boolean; description: string; name: string } };
  competitions: Array<{
    competitors: EspnCompetitor[];
  }>;
};

async function fetchEspn(dateStr: string): Promise<EspnEvent[]> {
  const url = espnUrl(dateStr);
  const res = await fetch(url, {
    headers: { "user-agent": "ncaam-model/1.0 (personal project)" },
  });
  if (!res.ok) {
    throw new Error(`ESPN API failed for dates=${dateStr} (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const json = (await res.json()) as { events?: EspnEvent[] };
  return json.events ?? [];
}

async function main() {
  // Fetch both the ET-date and the next UTC day.
  // Games tipping off after ~7pm ET have a UTC commence_time of the following
  // calendar day, so ESPN stores them under the next date.
  const [eventsToday, eventsNextUtc] = await Promise.all([
    fetchEspn(ESPN_DATE),
    fetchEspn(ESPN_DATE_NEXT),
  ]);

  console.log(`ESPN dates=${ESPN_DATE}: ${eventsToday.length} events`);
  console.log(`ESPN dates=${ESPN_DATE_NEXT} (next UTC day): ${eventsNextUtc.length} events`);

  // Merge and deduplicate by event id — prefer the record from "today" so
  // that if the same event appears in both responses we don't double-count.
  const eventMap = new Map<string, EspnEvent>();
  for (const e of [...eventsNextUtc, ...eventsToday]) {
    eventMap.set(e.id, e);
  }

  // Filter to only games whose commence_time falls within the ET date window.
  // This prevents tomorrow's scheduled games (fetched from dates=ESPN_DATE_NEXT)
  // from bleeding into today's results file.
  const allEvents = [...eventMap.values()];
  const events = allEvents.filter((e) => {
    const ct = new Date(e.date);
    return ct >= DAY_START_UTC && ct < DAY_END_UTC;
  });

  console.log(`After ET-window filter (${DATE}): ${events.length} of ${allEvents.length} events kept`);

  const games = events.map((e) => {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");

    const homeScore = home?.score != null ? Number(home.score) : null;
    const awayScore = away?.score != null ? Number(away.score) : null;
    const completed = e.status?.type?.completed ?? false;

    // actualSpread: from home's perspective (negative = home won by that margin)
    const actualSpread =
      completed && homeScore != null && awayScore != null
        ? -(homeScore - awayScore) // home won by X => spread = -X (home spread convention)
        : null;

    const winner: "HOME" | "AWAY" | "TIE" | null =
      completed && homeScore != null && awayScore != null
        ? homeScore > awayScore
          ? "HOME"
          : awayScore > homeScore
          ? "AWAY"
          : "TIE"
        : null;

    return {
      espnEventId: e.id,
      commence_time: e.date,
      home_team: home?.team.displayName ?? null,
      away_team: away?.team.displayName ?? null,
      home_espnTeamId: home?.team.id ?? null,
      away_espnTeamId: away?.team.id ?? null,
      completed,
      status: e.status?.type?.description ?? null,
      homeScore,
      awayScore,
      actualSpread,
      winner,
    };
  });

  const completed = games.filter((g) => g.completed).length;

  saveJson(OUT_FILE, {
    date: DATE,
    fetched_at: new Date().toISOString(),
    total_games: games.length,
    completed_games: completed,
    games,
  });

  console.log(`✅ Wrote results: ${OUT_FILE}`);
  console.log(`Games: ${games.length} total, ${completed} completed`);

  const incomplete = games.filter((g) => !g.completed);
  if (incomplete.length > 0) {
    console.warn(`⚠️  ${incomplete.length} game(s) not yet final:`);
    for (const g of incomplete) {
      console.warn(`   ${g.away_team} @ ${g.home_team} — ${g.status}`);
    }
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
