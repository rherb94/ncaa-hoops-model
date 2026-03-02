// src/scripts/fetchOddsOpenersForDate.ts
import fs from "node:fs";
import path from "node:path";
import { loadEspnTeamsIndex, norm as espnNorm } from "@/data/espn";
import { loadTeams } from "@/data/teams";
import { resolveTeamId } from "@/data/teamAliases";
import {
  computeEfficiencyModel,
  computeModelSpread,
  computeEdge,
  computeSignal,
} from "@/lib/model";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------- config ----------------
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
if (!ODDS_API_KEY) throw new Error("Missing THE_ODDS_API_KEY env var");

// Date to label the snapshot (YYYY-MM-DD). Default = today in UTC.
// Use || so an empty string from workflow_dispatch falls back to default.
const DATE =
  process.env.DATE || new Date().toISOString().slice(0, 10);

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

type LiveOddsResponse = OddsGame[];

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
  // Use the live endpoint — the GitHub Action runs at 11am ET specifically to
  // capture opening lines, so we just snapshot whatever is live at that moment.
  // This works on any API tier (no paid historical access required).
  const url =
    `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds` +
    `?apiKey=${encodeURIComponent(ODDS_API_KEY!)}` +
    `&regions=${encodeURIComponent(REGIONS)}` +
    `&markets=${encodeURIComponent(MARKETS)}` +
    `&oddsFormat=american`;

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

  const json = (await res.json()) as LiveOddsResponse;
  const capturedAt = new Date().toISOString();

  // Filter to only games starting on DATE in Eastern Time.
  // Midnight ET = 05:00 UTC in winter (EST) / 04:00 UTC during DST.
  // Using 05:00 UTC as the boundary is safe — no NCAAB games tip off between
  // midnight and 1am ET, so we never miss a real game with this cutoff.
  const dayStartUTC = new Date(`${DATE}T05:00:00Z`);
  const dayEndUTC   = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

  const filtered = (json ?? []).filter((g) => {
    const ct = new Date(g.commence_time);
    return ct >= dayStartUTC && ct < dayEndUTC;
  });

  console.log(`API returned ${json.length} games; keeping ${filtered.length} on ${DATE} ET`);

  // ESPN index (name lookup only)
  const espnIndex = loadEspnTeamsIndex() as any;
  const espnByName: Map<string, any> = (espnIndex?.byName ?? new Map()) as any;

  // load mapping file
  const oddsMap = loadJson<Record<string, string>>(MAP_FILE, {});

  // teams for model computation
  const teamsMap = loadTeams();

  const preferredBooks = ["draftkings", "fanduel", "betmgm"];

  const outGames: any[] = [];
  const misses: Array<{ side: "HOME" | "AWAY"; name: string; key: string }> =
    [];

  for (const g of filtered) {
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

    // --- model spread ---
    const homeTeamId = resolveTeamId({ provider: "theoddsapi", teamName: g.home_team });
    const awayTeamId = resolveTeamId({ provider: "theoddsapi", teamName: g.away_team });
    const homeTeam = homeTeamId ? teamsMap.get(homeTeamId) : undefined;
    const awayTeam = awayTeamId ? teamsMap.get(awayTeamId) : undefined;

    let modelData: {
      homeTeamId: string | null;
      awayTeamId: string | null;
      modelSpread: number | null;
      edge: number | null;
      signal: string;
    } | null = null;

    if (homeTeam && awayTeam) {
      const hca = homeTeam.hca ?? 2;
      const eff = computeEfficiencyModel(homeTeam, awayTeam, hca);
      const rawModelSpread =
        eff?.modelSpread ??
        computeModelSpread(homeTeam.powerRating, awayTeam.powerRating, hca);
      const marketSpread = spread?.homePoint;
      const modelSpread = rawModelSpread;
      const edgeRaw = computeEdge(modelSpread, marketSpread);
      const edge = edgeRaw === undefined ? null : clamp(edgeRaw, -12, 12);
      const signal = computeSignal(edge ?? undefined);

      modelData = {
        homeTeamId: homeTeamId ?? null,
        awayTeamId: awayTeamId ?? null,
        modelSpread,
        edge,
        signal,
      };
    }

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

      model: modelData,
    });
  }

  // Write output snapshot
  saveJson(OUT_FILE, {
    date: DATE,
    captured_at: capturedAt,
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
