// src/scripts/updateTeamsFromTorvik.ts
import fs from "node:fs";
import path from "node:path";

const YEAR = process.env.YEAR ?? "2026";

// If you want to run from a local file sometimes:
//   TORVIK_LOCAL=/absolute/path/to/2026_team_results.csv pnpm ts-node ...
const TORVIK_LOCAL = process.env.TORVIK_LOCAL;

const TORVIK_URL = `https://barttorvik.com/${YEAR}_team_results.csv`;

const TEAMS_CSV = path.join(process.cwd(), "src", "data", "teams.csv");
const OUT_CSV = TEAMS_CSV;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[()]/g, "")
    .replace(/['’]/g, "")
    .replace(/\./g, "")
    .replace(/\buniv\b/g, "university")
    .replace(/\bst\b/g, "saint") // IMPORTANT: st => saint, not state
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Torvik name quirks we already know we’ll hit.
// (Add to this as the script prints misses.)
const TORVIK_SYNONYMS: Record<string, string[]> = {
  // Penn / Pennsylvania
  pennsylvania: ["penn"],
  penn: ["pennsylvania"],

  // UT Martin
  "tennessee martin": ["ut martin", "tenn martin", "tenn-martin", "ut-martin"],
  "ut martin": ["tennessee martin"],

  // UMKC
  umkc: ["kansas city", "missouri kansas city", "missouri-kansas city"],
  "kansas city": ["umkc"],

  // Common “state / st” variants handled by norm(), but keep a few extras:
  lindenwood: ["lindenwood lions"],
  "southern indiana": ["southern indiana screaming eagles"],
};

type Parsed = { header: string[]; rows: string[][] };

function parseCsv(raw: string): Parsed {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const header = lines[0].split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((l) => l.split(",").map((s) => s.trim()));
  return { header, rows };
}

function idx(header: string[], name: string): number {
  return header.findIndex((h) => h.trim() === name);
}

function toNum(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : undefined;
}

function parseRecord(s: string | undefined): { w?: number; l?: number } {
  if (!s) return {};
  const m = String(s)
    .trim()
    .match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return {};
  return { w: Number(m[1]), l: Number(m[2]) };
}

function nameCandidates(name: string): string[] {
  const base = name.trim();
  const out = new Set<string>([base]);

  // no dots
  out.add(base.replace(/\./g, ""));

  // apply synonyms by normalized key
  const k = norm(base);
  const syn = TORVIK_SYNONYMS[k];
  if (syn) for (const s of syn) out.add(s);

  // also allow reverse synonyms (if a synonym is the base)
  for (const [k2, arr] of Object.entries(TORVIK_SYNONYMS)) {
    if (k2 === k) continue;
    if (arr.some((x) => norm(x) === k)) out.add(k2);
  }

  return [...out];
}

async function readTorvikCsv(): Promise<string> {
  if (TORVIK_LOCAL && fs.existsSync(TORVIK_LOCAL)) {
    return fs.readFileSync(TORVIK_LOCAL, "utf-8");
  }
  const res = await fetch(TORVIK_URL, {
    headers: {
      "user-agent": "ncaam-model/1.0 (personal project)",
      accept: "text/csv",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch Torvik CSV (${res.status}) ${TORVIK_URL}\n${text.slice(
        0,
        300
      )}`
    );
  }
  return res.text();
}

function writeCsv(header: string[], rows: string[][]) {
  const out =
    header.join(",") +
    "\n" +
    rows.map((r) => r.map((x) => x ?? "").join(",")).join("\n") +
    "\n";
  fs.writeFileSync(OUT_CSV, out, "utf-8");
}

async function main() {
  if (!fs.existsSync(TEAMS_CSV)) throw new Error(`Missing ${TEAMS_CSV}`);

  const teamsRaw = fs.readFileSync(TEAMS_CSV, "utf-8");
  const teams = parseCsv(teamsRaw);

  // Existing teams.csv must have teamId + teamName at minimum
  const iTeamId = idx(teams.header, "teamId");
  const iTeamName =
    idx(teams.header, "teamName") >= 0
      ? idx(teams.header, "teamName")
      : idx(teams.header, "name");
  const iConf = idx(teams.header, "conference");

  if (iTeamId < 0 || iTeamName < 0) {
    throw new Error(
      "teams.csv must contain teamId and teamName (or name) columns"
    );
  }

  // Fetch Torvik
  const torvikRaw = await readTorvikCsv();
  const torvik = parseCsv(torvikRaw);

  const tTeam = idx(torvik.header, "team");
  const tConf = idx(torvik.header, "conf");
  const tRec = idx(torvik.header, "record");
  const tAdjO = idx(torvik.header, "adjoe");
  const tAdjD = idx(torvik.header, "adjde");
  const tTempo = idx(torvik.header, "adjt");
  const tBarthag = idx(torvik.header, "barthag");
  const tRank = idx(torvik.header, "rank");
  const tOERank = idx(torvik.header, "oe Rank");
  const tDERank = idx(torvik.header, "de Rank");

  const needed = [
    ["team", tTeam],
    ["adjoe", tAdjO],
    ["adjde", tAdjD],
    ["adjt", tTempo],
    ["record", tRec],
    ["barthag", tBarthag],
    ["rank", tRank],
    ["oe Rank", tOERank],
    ["de Rank", tDERank],
  ] as const;

  const missing = needed.filter(([, i]) => i < 0).map(([n]) => n);
  if (missing.length) {
    throw new Error(
      `Torvik CSV missing expected columns: ${missing.join(", ")}`
    );
  }

  // Build Torvik lookup by normalized name
  type TorvikTeam = {
    name: string;
    conf?: string;
    w?: number;
    l?: number;
    adjO?: number; // adjoe
    adjD?: number; // adjde
    adjT?: number; // adjt
    barthag?: number;
    rank?: number;
    oeRank?: number;
    deRank?: number;

    // FIXED:
    // We want "points/game-ish" rating so it matches how your model treats PR.
    // Torvik adjoe/adjde are per 100 possessions, so:
    //   AdjEM = adjoe - adjde (per 100 poss)
    //   PR (pts/game) ≈ AdjEM * AdjT / 100
    powerRating?: number;
  };

  const torvikByName = new Map<string, TorvikTeam>();

  for (const r of torvik.rows) {
    const name = (r[tTeam] ?? "").trim();
    if (!name) continue;

    const { w, l } = parseRecord(r[tRec]);
    const adjO = toNum(r[tAdjO]);
    const adjD = toNum(r[tAdjD]);
    const adjT = toNum(r[tTempo]);
    const barthag = toNum(r[tBarthag]);
    const rank = toNum(r[tRank]);
    const oeRank = toNum(r[tOERank]);
    const deRank = toNum(r[tDERank]);

    const adjEm =
      adjO != null && adjD != null ? Number(adjO) - Number(adjD) : undefined;

    // PR FIX:
    const powerRating =
      adjEm != null && adjT != null
        ? Number(((adjEm * Number(adjT)) / 100).toFixed(3))
        : undefined;

    const trow: TorvikTeam = {
      name,
      conf: tConf >= 0 ? (r[tConf] ?? "").trim() : undefined,
      w,
      l,
      adjO,
      adjD,
      adjT,
      barthag,
      rank,
      oeRank,
      deRank,
      powerRating,
    };

    torvikByName.set(norm(name), trow);
  }

  // Ensure output columns exist (append if not)
  const ensureCol = (col: string) => {
    let i = idx(teams.header, col);
    if (i >= 0) return i;
    teams.header.push(col);
    for (const r of teams.rows) r.push("");
    return teams.header.length - 1;
  };

  const oPR = ensureCol("powerRating");
  const oAdjO = ensureCol("adjO");
  const oAdjD = ensureCol("adjD");
  const oTempo = ensureCol("tempo");
  const oBarthag = ensureCol("barthag");
  const oRank = ensureCol("torvikRank");
  const oOERank = ensureCol("torvikOeRank");
  const oDERank = ensureCol("torvikDeRank");
  const oW = ensureCol("wins");
  const oL = ensureCol("losses");

  const misses: Array<{ teamId: string; teamName: string }> = [];

  for (const row of teams.rows) {
    const teamId = (row[iTeamId] ?? "").trim();
    const teamName = (row[iTeamName] ?? "").trim();
    if (!teamId || !teamName) continue;

    let hit: TorvikTeam | undefined;

    for (const cand of nameCandidates(teamName)) {
      hit = torvikByName.get(norm(cand));
      if (hit) break;
    }

    // If not found, try conference-qualified variant (rarely needed)
    if (!hit && iConf >= 0) {
      const conf = (row[iConf] ?? "").trim();
      if (conf) {
        for (const cand of nameCandidates(teamName)) {
          const maybe = torvikByName.get(norm(cand));
          if (maybe && maybe.conf && norm(maybe.conf) === norm(conf)) {
            hit = maybe;
            break;
          }
        }
      }
    }

    if (!hit) {
      misses.push({ teamId, teamName });
      continue;
    }

    // Overwrite fields we’re now sourcing from Torvik
    row[oPR] = hit.powerRating != null ? String(hit.powerRating) : "";
    row[oAdjO] = hit.adjO != null ? String(hit.adjO) : "";
    row[oAdjD] = hit.adjD != null ? String(hit.adjD) : "";
    row[oTempo] = hit.adjT != null ? String(hit.adjT) : "";
    row[oBarthag] = hit.barthag != null ? String(hit.barthag) : "";
    row[oRank] = hit.rank != null ? String(Math.round(hit.rank)) : "";
    row[oOERank] = hit.oeRank != null ? String(Math.round(hit.oeRank)) : "";
    row[oDERank] = hit.deRank != null ? String(Math.round(hit.deRank)) : "";
    row[oW] = hit.w != null ? String(hit.w) : "";
    row[oL] = hit.l != null ? String(hit.l) : "";
  }

  writeCsv(teams.header, teams.rows);

  console.log(`✅ Updated teams.csv from Torvik ${YEAR}: ${OUT_CSV}`);
  console.log(`Torvik URL: ${TORVIK_URL}`);
  console.log(`Rows: ${teams.rows.length}`);

  if (misses.length) {
    console.warn(`⚠️ Torvik match misses (${misses.length}):`);
    for (const m of misses.slice(0, 25)) {
      console.warn(`  - ${m.teamId} | ${m.teamName}`);
    }
    if (misses.length > 25) console.warn(`  ...and ${misses.length - 25} more`);
    console.warn(
      `Add synonyms in TORVIK_SYNONYMS in this script for the misses above.`
    );
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
