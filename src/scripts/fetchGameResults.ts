// src/scripts/fetchGameResults.ts
// Fetches final scores from ESPN's public scoreboard API and saves to
// src/data/results/YYYY-MM-DD.json. Run after games finish (midnight ET).
import fs from "node:fs";
import path from "node:path";

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
// groups=50 = NCAA Division I Men's Basketball — without this ESPN only
// returns a small "featured" subset of games, not the full D1 slate.
const ESPN_URL =
  `https://site.api.espn.com/apis/site/v2/sports/basketball` +
  `/mens-college-basketball/scoreboard?dates=${ESPN_DATE}&groups=50&limit=200`;

const OUT_DIR = path.join(process.cwd(), "src", "data", "results");
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

async function main() {
  const res = await fetch(ESPN_URL, {
    headers: { "user-agent": "ncaam-model/1.0 (personal project)" },
  });

  if (!res.ok) {
    throw new Error(`ESPN API failed (${res.status}): ${await res.text().catch(() => "")}`);
  }

  const json = (await res.json()) as { events?: EspnEvent[] };
  const events = json.events ?? [];

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
