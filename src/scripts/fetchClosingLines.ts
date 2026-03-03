// src/scripts/fetchClosingLines.ts
// Captures a "closing line" snapshot from TheOddsAPI and saves to
// src/data/closing_lines/YYYY-MM-DD.json. Used for CLV analysis.
//
// IMPORTANT LIMITATIONS:
// TheOddsAPI's /odds endpoint only returns UPCOMING (not-yet-started) games.
// Once a game tips off, it disappears from the response. This means:
//   - Run at 5pm ET  → captures pre-game lines for ~5pm+ games
//   - Noon ET games  → will have started; no closing line available
//   - 8pm ET games   → captured, but still ~3 hrs before true close
//
// For best coverage, schedule TWO runs:
//   1. 3:00pm ET (20:00 UTC) — early games
//   2. 7:30pm ET (00:30 UTC next day) — evening games
// The analysis API uses whichever lines exist; games with no closing data show "—".
//
// Run: npx tsx src/scripts/fetchClosingLines.ts

import fs from "node:fs";
import path from "node:path";

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
if (!ODDS_API_KEY) throw new Error("Missing THE_ODDS_API_KEY env var");

// Date to label snapshot (YYYY-MM-DD). Default = today in ET.
const DATE =
  process.env.DATE ||
  (() => {
    const d = new Date();
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
      .format(d)
      .slice(0, 10);
  })();

const SPORT_KEY = "basketball_ncaab";
const REGIONS = "us";
const MARKETS = "spreads";

const OUT_DIR = path.join(process.cwd(), "src", "data", "closing_lines");
const OUT_FILE = path.join(OUT_DIR, `${DATE}.json`);

function saveJson(p: string, obj: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

type OddsOutcome = { name: string; price?: number; point?: number };
type OddsMarket = { key: string; outcomes: OddsOutcome[] };
type OddsBookmaker = {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
};
type OddsGame = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
};

const PREFERRED_BOOKS = ["draftkings", "fanduel", "betmgm"];

function pickBookSpread(game: OddsGame) {
  const books = game.bookmakers ?? [];
  const byKey = new Map(books.map((b) => [b.key, b]));

  for (const key of PREFERRED_BOOKS) {
    const b = byKey.get(key);
    if (!b) continue;
    const m = b.markets?.find((x) => x.key === "spreads");
    if (!m) continue;
    const home = m.outcomes.find((o) => o.name === game.home_team);
    const away = m.outcomes.find((o) => o.name === game.away_team);
    if (home?.point == null || away?.point == null) continue;
    return { book: b.key, homePoint: Number(home.point), awayPoint: Number(away.point) };
  }

  // fallback: first book with spreads
  for (const b of books) {
    const m = b.markets?.find((x) => x.key === "spreads");
    if (!m) continue;
    const home = m.outcomes.find((o) => o.name === game.home_team);
    const away = m.outcomes.find((o) => o.name === game.away_team);
    if (home?.point == null || away?.point == null) continue;
    return { book: b.key, homePoint: Number(home.point), awayPoint: Number(away.point) };
  }

  return null;
}

async function main() {
  const url =
    `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds` +
    `?apiKey=${encodeURIComponent(ODDS_API_KEY!)}` +
    `&regions=${encodeURIComponent(REGIONS)}` +
    `&markets=${encodeURIComponent(MARKETS)}` +
    `&oddsFormat=american`;

  const res = await fetch(url, {
    headers: { "user-agent": "ncaam-model/1.0 (personal project)" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Odds API failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as OddsGame[];
  const capturedAt = new Date().toISOString();

  // Filter to games on DATE in ET (games that haven't started yet are returned by the API)
  const dayStartUTC = new Date(`${DATE}T05:00:00Z`);
  const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

  const filtered = (json ?? []).filter((g) => {
    const ct = new Date(g.commence_time);
    return ct >= dayStartUTC && ct < dayEndUTC;
  });

  // Load existing file (may have been written by an earlier run today)
  let existing: Record<string, { homePoint: number; awayPoint: number; book: string; updatedAt: string }> = {};
  try {
    const old = JSON.parse(fs.readFileSync(OUT_FILE, "utf-8"));
    for (const g of old.games ?? []) {
      if (g.oddsEventId && g.homePoint != null) {
        existing[g.oddsEventId] = {
          homePoint: g.homePoint,
          awayPoint: g.awayPoint,
          book: g.book,
          updatedAt: g.updatedAt ?? old.captured_at,
        };
      }
    }
  } catch {
    // file may not exist yet — that's fine
  }

  const games = filtered.map((g) => {
    const spread = pickBookSpread(g);
    return {
      oddsEventId: g.id,
      home_team: g.home_team,
      away_team: g.away_team,
      commence_time: g.commence_time,
      homePoint: spread?.homePoint ?? null,
      awayPoint: spread?.awayPoint ?? null,
      book: spread?.book ?? null,
      updatedAt: capturedAt,
    };
  });

  // Merge: prefer freshly fetched data, but preserve existing entries for
  // games that have since started (no longer in API response)
  const merged = new Map<string, typeof games[number]>();

  // Start with existing data (for games that already started)
  for (const [id, prev] of Object.entries(existing)) {
    merged.set(id, {
      oddsEventId: id,
      home_team: "",
      away_team: "",
      commence_time: "",
      homePoint: prev.homePoint,
      awayPoint: prev.awayPoint,
      book: prev.book,
      updatedAt: prev.updatedAt,
    });
  }

  // Overwrite with fresh data (more accurate for games still upcoming)
  for (const g of games) {
    merged.set(g.oddsEventId, g);
  }

  const allGames = [...merged.values()];
  const freshCount = games.length;
  const preservedCount = allGames.length - freshCount;

  saveJson(OUT_FILE, {
    date: DATE,
    captured_at: capturedAt,
    games: allGames,
  });

  console.log(`✅ Wrote closing lines: ${OUT_FILE}`);
  console.log(`  ${freshCount} fresh from API, ${preservedCount} preserved from earlier snapshot`);
  console.log(`  Total: ${allGames.length} games with closing lines for ${DATE}`);
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
