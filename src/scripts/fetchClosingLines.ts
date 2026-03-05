// src/scripts/fetchClosingLines.ts
// Fetches closing lines using TheOddsAPI's historical endpoint (paid plan required).
//
// The historical endpoint returns odds as they existed at a specific UTC timestamp,
// making true closing-line capture possible without polling every minute.
//
// Strategy: run twice per day, each time passing SNAPSHOT_TIME to the historical API.
//   Run 1 — ~11:50am ET: captures closing lines for noon and early afternoon games
//   Run 2 — ~6:50pm ET:  captures closing lines for evening games (7pm+)
//
// Results are MERGED into a single file per date. Each game keeps its LATEST snapshot,
// so subsequent runs for evening games don't overwrite already-captured noon-game lines.
//
// CLV = (opening_homePoint - closing_homePoint) * direction_sign
//   Positive CLV = we beat the closing line (the market agreed with us later).
//
// Env vars:
//   THE_ODDS_API_KEY  — required
//   DATE              — YYYY-MM-DD, defaults to today in ET
//   SNAPSHOT_TIME     — ISO 8601 UTC timestamp for the historical query;
//                       defaults to the current time (i.e., "right now")
//
// Run: npx tsx src/scripts/fetchClosingLines.ts

import fs from "node:fs";
import path from "node:path";
import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
if (!ODDS_API_KEY) throw new Error("Missing THE_ODDS_API_KEY env var");

const LEAGUE = process.env.LEAGUE || "ncaam"; // use || so empty string also falls back

// Date to label snapshot (YYYY-MM-DD). Default = today in ET.
const DATE =
  process.env.DATE ||
  (() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
      .format(new Date())
      .slice(0, 10);
  })();

// The historical snapshot timestamp. Default = now (useful for manual runs).
// GitHub Actions passes this as the actual cron trigger time so every run is
// reproducible (in case the job starts slightly late).
const SNAPSHOT_TIME = process.env.SNAPSHOT_TIME || new Date().toISOString();

const SPORT_KEY = LEAGUES[LEAGUE as LeagueId]?.sportKey ?? "basketball_ncaab";
const REGIONS = "us";
const MARKETS = "spreads";

const OUT_DIR = path.join(process.cwd(), "src", "data", LEAGUE, "closing_lines");
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

// Historical endpoint response wraps games in a `data` key
type HistoricalResponse = {
  data: OddsGame[];
  timestamp: string;          // actual snapshot time (nearest cached snapshot)
  previous_timestamp: string;
  next_timestamp: string;
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

type ClosingEntry = {
  oddsEventId: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  homePoint: number | null;
  awayPoint: number | null;
  book: string | null;
  snapshotTime: string; // actual UTC timestamp of this snapshot
};

async function main() {
  // Historical endpoint: returns odds as they existed at SNAPSHOT_TIME.
  // Only games that had not yet started at that moment are included.
  const url =
    `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds-history` +
    `?apiKey=${encodeURIComponent(ODDS_API_KEY!)}` +
    `&date=${encodeURIComponent(SNAPSHOT_TIME)}` +
    `&regions=${encodeURIComponent(REGIONS)}` +
    `&markets=${encodeURIComponent(MARKETS)}` +
    `&oddsFormat=american`;

  const res = await fetch(url, {
    headers: { "user-agent": "ncaam-model/1.0 (personal project)" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = `Odds API historical failed (${res.status}): ${text.slice(0, 300)}`;
    // 402 = quota exceeded, 429 = rate limited — treat as soft failure so the
    // workflow doesn't crash and the existing first-run data is preserved.
    if (res.status === 402 || res.status === 429 || res.status === 422) {
      console.warn(`⚠️  ${msg}`);
      console.warn("Skipping this run — existing closing-line data is preserved.");
      return;
    }
    throw new Error(msg);
  }

  const json = (await res.json()) as HistoricalResponse;
  // The API returns the actual cached snapshot time (may differ slightly from requested)
  const actualSnapshotTime = json.timestamp ?? SNAPSHOT_TIME;

  console.log(`Requested: ${SNAPSHOT_TIME}`);
  console.log(`Actual snapshot: ${actualSnapshotTime}`);
  console.log(`Previous: ${json.previous_timestamp ?? "—"}`);
  console.log(`Next: ${json.next_timestamp ?? "—"}`);
  console.log(`Games in response: ${json.data?.length ?? 0}`);

  // Filter to games on DATE in ET (same window as the opener script)
  const dayStartUTC = new Date(`${DATE}T05:00:00Z`);
  const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

  const filtered = (json.data ?? []).filter((g) => {
    const ct = new Date(g.commence_time);
    return ct >= dayStartUTC && ct < dayEndUTC;
  });

  console.log(`Filtered to ${DATE} ET window: ${filtered.length} games`);

  // Build fresh entries from this snapshot
  const fresh = new Map<string, ClosingEntry>();
  for (const g of filtered) {
    const spread = pickBookSpread(g);
    fresh.set(g.id, {
      oddsEventId: g.id,
      home_team: g.home_team,
      away_team: g.away_team,
      commence_time: g.commence_time,
      homePoint: spread?.homePoint ?? null,
      awayPoint: spread?.awayPoint ?? null,
      book: spread?.book ?? null,
      snapshotTime: actualSnapshotTime,
    });
  }

  // Load existing file to preserve entries from earlier runs (e.g., noon games
  // captured in the first run won't be in the second run because they've already started)
  const existing = new Map<string, ClosingEntry>();
  try {
    const old = JSON.parse(fs.readFileSync(OUT_FILE, "utf-8"));
    for (const g of old.games ?? []) {
      if (g.oddsEventId) existing.set(g.oddsEventId, g as ClosingEntry);
    }
    console.log(`Loaded ${existing.size} existing entries from prior run`);
  } catch {
    // file may not exist yet on the first run of the day
  }

  // Merge: prefer the snapshot with the LATER snapshotTime for games present in both.
  // This means the second run updates evening-game lines while preserving noon-game lines.
  const merged = new Map<string, ClosingEntry>([...existing]);
  let updated = 0;
  let preserved = 0;

  for (const [id, entry] of fresh) {
    const prev = existing.get(id);
    if (!prev || entry.snapshotTime > prev.snapshotTime) {
      merged.set(id, entry);
      updated++;
    } else {
      preserved++;
    }
  }

  // Games in existing that weren't in fresh (already started) are kept as-is
  const keptFromPrior = existing.size - preserved;

  console.log(`Updated: ${updated}, preserved from prior: ${keptFromPrior + preserved}`);
  console.log(`Total closing lines: ${merged.size} games for ${DATE}`);

  saveJson(OUT_FILE, {
    date: DATE,
    last_updated: new Date().toISOString(),
    snapshot_times: [...new Set([...merged.values()].map((g) => g.snapshotTime))].sort(),
    games: [...merged.values()],
  });

  console.log(`✅ Wrote closing lines: ${OUT_FILE}`);
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
