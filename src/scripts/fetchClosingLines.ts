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
    // Treat all API errors as soft failures — any existing data from an earlier
    // run (e.g. the 11:50am snapshot) is preserved. Possible causes: quota (402),
    // rate limit (429), snapshot not yet cached for the requested time, etc.
    console.warn(`⚠️  ${msg}`);
    console.warn("Skipping this run — existing closing-line data is preserved.");
    return;
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
  const snapshotMs = new Date(actualSnapshotTime).getTime();

  const dateFiltered = (json.data ?? []).filter((g) => {
    const ct = new Date(g.commence_time);
    return ct >= dayStartUTC && ct < dayEndUTC;
  });

  // Drop games that have already started at the time of this snapshot.
  // The historical API can return live in-game lines for in-progress games —
  // those aren't true closing lines and produce wildly incorrect CLV values.
  const filtered = dateFiltered.filter((g) => {
    const alreadyStarted = new Date(g.commence_time).getTime() <= snapshotMs;
    if (alreadyStarted) {
      console.warn(
        `⚠️  Skipping already-started game: ${g.away_team} @ ${g.home_team}` +
        ` (tipped ${g.commence_time}, snapshot ${actualSnapshotTime})`
      );
    }
    return !alreadyStarted;
  });

  console.log(
    `API returned ${json.data?.length ?? 0} games; ${dateFiltered.length} on ${DATE} ET;` +
    ` ${filtered.length} not yet started`
  );

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

  // Merge: prefer the snapshot closest to (but before) the game's commence_time.
  // For games not yet in the file, add them. For games already present, only update
  // if the new snapshot is later AND still before the game started — this ensures
  // the second run can update evening games (not yet captured) while preserving
  // noon-game lines that would be overwritten with live in-game lines in a later run.
  const merged = new Map<string, ClosingEntry>([...existing]);
  let updated = 0;
  let preserved = 0;

  for (const [id, entry] of fresh) {
    const prev = existing.get(id);
    // Double-check: skip if this snapshot was taken after the game started
    // (the filter above should catch this, but be defensive)
    const entryAfterStart = new Date(entry.snapshotTime) > new Date(entry.commence_time);
    if (entryAfterStart) {
      console.warn(`⚠️  Merge: skipping post-start snapshot for ${entry.away_team} @ ${entry.home_team}`);
      preserved++;
      continue;
    }
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

  // ---- Dual-write to DB (best-effort, non-blocking) ----
  if (process.env.POSTGRES_URL) {
    try {
      const { syncClosingLinesToDb } = await import("@/db/dailySync");
      const linesForDb = [...merged.values()].map((g) => ({
        oddsEventId:  g.oddsEventId,
        homePoint:    g.homePoint,
        awayPoint:    g.awayPoint,
        book:         g.book,
        snapshotTime: g.snapshotTime,
      }));
      await syncClosingLinesToDb(LEAGUE, DATE, linesForDb);
      console.log(`✅ DB sync: ${linesForDb.length} closing line(s) written`);
    } catch (err) {
      console.warn("⚠️  DB sync failed (JSON file is unaffected):", err);
    }
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
