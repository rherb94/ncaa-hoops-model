// src/scripts/fetchOddsOpenersForDate.ts
import fs from "node:fs";
import path from "node:path";
import { loadEspnTeamsIndex, norm as espnNorm } from "@/data/espn";

// ---------------- config ----------------
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
if (!ODDS_API_KEY) throw new Error("Missing THE_ODDS_API_KEY env var");

// Date you want to pull (YYYY-MM-DD). Default = yesterday in UTC.
const DATE =
  process.env.DATE ??
  new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Snapshot time (ISO). Default = DATE at 16:00Z
const SNAPSHOT_ISO = process.env.SNAPSHOT_ISO ?? `${DATE}T16:00:00Z`;

const SPORT_KEY = "basketball_ncaab";
const REGIONS = "us";
const MARKETS = "spreads";

const OUT_DIR = path.join(process.cwd(), "src", "data", "odds_opening");
const OUT_FILE = path.join(OUT_DIR, `${DATE}.json`);

const MAP_FILE = path.join(
  process.cwd(),
  "src",
  "data",
  "oddsTeamToEspnTeamId.json"
);

// If STRICT=1, exit non-zero if any unmapped teams remain.
const STRICT = process.env.STRICT === "1";

// ---------------- helpers ----------------
function fileExists(p: string) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// Normalize Odds team names like "UTSA Roadrunners" consistently
function normOddsTeamName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/\./g, "")
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadJson<T>(p: string, fallback: T): T {
  if (!fileExists(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function saveJson(p: string, obj: any) {
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

type HistoricalOddsResponse = {
  timestamp: string;
  previous_timestamp?: string;
  next_timestamp?: string;
  data: OddsGame[];
};

function pickBookSpread(game: OddsGame, preferredBooks: string[]) {
  const books = game.bookmakers ?? [];
  const byKey = new Map(books.map((b) => [b.key, b]));

  for (const key of preferredBooks) {
    const b = byKey.get(key);
    if (!b) continue;
    const m = b.markets?.find((x) => x.key === "spreads");
    if (!m) continue;

    const home = m.outcomes.find((o) => o.name === game.home_team);
    const away = m.outcomes.find((o) => o.name === game.away_team);
    if (home?.point == null || away?.point == null) continue;

    return {
      book: b.key,
      last_update: b.last_update,
      homePoint: Number(home.point),
      awayPoint: Number(away.point),
    };
  }

  // fallback: first book that has spreads
  for (const b of books) {
    const m = b.markets?.find((x) => x.key === "spreads");
    if (!m) continue;
    const home = m.outcomes.find((o) => o.name === game.home_team);
    const away = m.outcomes.find((o) => o.name === game.away_team);
    if (home?.point == null || away?.point == null) continue;

    return {
      book: b.key,
      last_update: b.last_update,
      homePoint: Number(home.point),
      awayPoint: Number(away.point),
    };
  }

  return null;
}

function resolveEspnTeamIdFromOddsName(
  oddsName: string,
  existingMap: Record<string, string>,
  espnByName: Map<string, any>
): { espnTeamId?: string; method: string } {
  const k = normOddsTeamName(oddsName);

  // 1) explicit mapping file = SOURCE OF TRUTH (no guessing, no index validation)
  const mapped = existingMap[k];
  if (mapped) return { espnTeamId: String(mapped), method: "MAP" };

  // 2) Optional: offer suggestions ONLY for logging (do not auto-use)
  // Try direct ESPN-by-name match (often works when name is clean).
  const hit = espnByName.get(espnNorm(oddsName));
  if (hit?.id) return { espnTeamId: String(hit.id), method: "ESPN_BY_NAME" };

  return { method: "MISS" };
}

function topEspnSuggestions(oddsName: string, espnByName: Map<string, any>) {
  // keep it deterministic + cheap: just try a few “trim” variants
  const out: Array<{ cand: string; id?: string; name?: string }> = [];
  const base = String(oddsName ?? "").trim();
  const toks = base.split(/\s+/).filter(Boolean);

  const candidates = new Set<string>([base]);

  // strip mascot-ish tail: first 1..4 tokens
  for (let n = Math.min(4, toks.length); n >= 1; n--) {
    candidates.add(toks.slice(0, n).join(" "));
  }

  for (const cand of candidates) {
    const hit = espnByName.get(espnNorm(cand));
    if (hit?.id) out.push({ cand, id: String(hit.id), name: hit.name });
    if (out.length >= 5) break;
  }

  return out;
}

// ---------------- main ----------------
async function main() {
  const url =
    `https://api.the-odds-api.com/v4/historical/sports/${SPORT_KEY}/odds` +
    `?apiKey=${encodeURIComponent(ODDS_API_KEY!)}` +
    `&regions=${encodeURIComponent(REGIONS)}` +
    `&markets=${encodeURIComponent(MARKETS)}` +
    `&oddsFormat=american` +
    `&date=${encodeURIComponent(SNAPSHOT_ISO)}`;

  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "ncaam-model/1.0 (personal project)",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Odds API failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as HistoricalOddsResponse;

  // ESPN index (name lookup only)
  const espnIndex = loadEspnTeamsIndex() as any;
  const espnByName: Map<string, any> = (espnIndex?.byName ?? new Map()) as any;

  // load mapping file
  const oddsMap = loadJson<Record<string, string>>(MAP_FILE, {});

  const preferredBooks = ["draftkings", "fanduel", "betmgm"];

  const outGames: any[] = [];
  const misses: Array<{ side: "HOME" | "AWAY"; name: string; key: string }> =
    [];

  for (const g of json.data ?? []) {
    const spread = pickBookSpread(g, preferredBooks);

    const homeKey = normOddsTeamName(g.home_team);
    const awayKey = normOddsTeamName(g.away_team);

    const homeRes = resolveEspnTeamIdFromOddsName(
      g.home_team,
      oddsMap,
      espnByName
    );
    const awayRes = resolveEspnTeamIdFromOddsName(
      g.away_team,
      oddsMap,
      espnByName
    );

    if (!homeRes.espnTeamId)
      misses.push({ side: "HOME", name: g.home_team, key: homeKey });
    if (!awayRes.espnTeamId)
      misses.push({ side: "AWAY", name: g.away_team, key: awayKey });

    outGames.push({
      oddsEventId: g.id,
      commence_time: g.commence_time,
      home_team: g.home_team,
      away_team: g.away_team,

      home_espnTeamId: homeRes.espnTeamId ?? null,
      away_espnTeamId: awayRes.espnTeamId ?? null,
      home_resolve: homeRes.method,
      away_resolve: awayRes.method,

      opening: spread
        ? {
            book: spread.book,
            last_update: spread.last_update,
            homePoint: spread.homePoint,
            awayPoint: spread.awayPoint,
          }
        : null,
    });
  }

  // Write output snapshot
  saveJson(OUT_FILE, {
    date: DATE,
    requested_snapshot: SNAPSHOT_ISO,
    snapshot_timestamp: json.timestamp,
    previous_timestamp: json.previous_timestamp ?? null,
    next_timestamp: json.next_timestamp ?? null,
    games: outGames,
  });

  console.log(`✅ Wrote opening snapshot: ${OUT_FILE}`);
  console.log(`Games: ${outGames.length}`);

  if (misses.length) {
    // de-dupe misses by normalized key (this is what you will pin)
    const uniq = new Map<string, { side: string; name: string; key: string }>();
    for (const m of misses) {
      if (!uniq.has(m.key)) uniq.set(m.key, m);
    }

    console.error(
      `\n🚨 UNMAPPED ODDS TEAMS (${uniq.size}) — PIN THESE IN oddsTeamToEspnTeamId.json\n`
    );

    for (const m of [...uniq.values()].sort((a, b) =>
      a.key.localeCompare(b.key)
    )) {
      console.error(`PIN ME: ${m.side} | raw="${m.name}" | key="${m.key}"`);

      const sugg = topEspnSuggestions(m.name, espnByName);
      if (sugg.length) {
        for (const s of sugg) {
          console.error(
            `  suggestion: cand="${s.cand}" -> espnId=${s.id} ("${
              s.name ?? ""
            }")`
          );
        }
      } else {
        console.error(`  suggestion: (none from simple trims)`);
      }
      console.error("");
    }

    if (STRICT) process.exit(2);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
