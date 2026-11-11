// src/scripts/updateTeamsFromTorvik.ts
import fs from "node:fs";
import path from "node:path";
import { basketballSeasonYear } from "@/lib/season";

// Season year (the year the season ends in). Derived from today's date unless
// YEAR is set; `||` so an empty string from a workflow input also falls back.
const YEAR = process.env.YEAR || String(basketballSeasonYear());
const LEAGUE = (process.env.LEAGUE ?? "ncaam") as "ncaam" | "ncaaw";

// Existing overall CSV source
const TORVIK_LOCAL = process.env.TORVIK_LOCAL;

const TORVIK_BASE_URL =
  LEAGUE === "ncaaw"
    ? `https://barttorvik.com/ncaaw/${YEAR}_team_results.csv`
    : `https://barttorvik.com/${YEAR}_team_results.csv`;

const TORVIK_URL = process.env.TORVIK_URL || TORVIK_BASE_URL;

// Venue splits are opt-in. Torvik ignores the `?venue=H|A` query on this CSV
// (checked 2026-11-11: both return the same rows as the overall file), so the
// old defaults just tripled the requests to a host that rate-limits bots.
// Set TORVIK_HOME_URL / TORVIK_AWAY_URL (or the *_LOCAL paths) to a real
// split source to re-enable homeTeams.csv / awayTeams.csv.
const TORVIK_HOME_LOCAL = process.env.TORVIK_HOME_LOCAL;
const TORVIK_AWAY_LOCAL = process.env.TORVIK_AWAY_LOCAL;
const TORVIK_HOME_URL = process.env.TORVIK_HOME_URL || undefined;
const TORVIK_AWAY_URL = process.env.TORVIK_AWAY_URL || undefined;

// Output files
const TEAMS_CSV = path.join(process.cwd(), "src", "data", LEAGUE, "teams.csv");
const OUT_OVERALL = TEAMS_CSV;
const OUT_HOME = path.join(process.cwd(), "src", "data", LEAGUE, "homeTeams.csv");
const OUT_AWAY = path.join(process.cwd(), "src", "data", LEAGUE, "awayTeams.csv");

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[()]/g, "")
    .replace(/['']/g, "")
    .replace(/\./g, "")
    .replace(/\buniv\b/g, "university")
    .replace(/\bst\b/g, "saint") // IMPORTANT: st => saint, not state
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Torvik name quirks we already know we'll hit.
const TORVIK_SYNONYMS: Record<string, string[]> = {
  pennsylvania: ["penn"],
  penn: ["pennsylvania"],

  "tennessee martin": ["ut martin", "tenn martin", "tenn-martin", "ut-martin"],
  "ut martin": ["tennessee martin"],

  umkc: ["kansas city", "missouri kansas city", "missouri-kansas city"],
  "kansas city": ["umkc"],

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

  out.add(base.replace(/\./g, ""));

  const k = norm(base);
  const syn = TORVIK_SYNONYMS[k];
  if (syn) for (const s of syn) out.add(s);

  for (const [k2, arr] of Object.entries(TORVIK_SYNONYMS)) {
    if (k2 === k) continue;
    if (arr.some((x) => norm(x) === k)) out.add(k2);
  }

  return [...out];
}

async function readTorvikCsv(opts: {
  localPath?: string;
  url?: string;
  label: string;
}): Promise<string> {
  const { localPath, url, label } = opts;

  if (localPath && fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, "utf-8");
  }
  if (!url) {
    throw new Error(
      `[${label}] Missing URL. Set ${label} via env (e.g. TORVIK_HOME_URL) or provide a local file.`
    );
  }

  // Torvik sits behind bot protection that intermittently 403s (or serves an
  // HTML challenge with a 200) to datacenter IPs, so retry a few times and
  // refuse anything that isn't the CSV we expect.
  const delaysMs = [0, 5_000, 20_000, 60_000];
  let lastErr = "";
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt]) await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
          // Only relevant when TORVIK_URL points at our own /api/torvik
          // pass-through: optional shared secret, and Vercel's deployment-
          // protection bypass token if the site sits behind Vercel auth.
          ...(process.env.TORVIK_PROXY_SECRET
            ? { "x-proxy-secret": process.env.TORVIK_PROXY_SECRET }
            : {}),
          ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
            ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
            : {}),
        },
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        lastErr = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      } else if (!/^rank,team,/i.test(text.trimStart())) {
        lastErr = `200 but not the expected CSV (starts: ${JSON.stringify(text.slice(0, 80))})`;
      } else {
        return text;
      }
    } catch (e) {
      lastErr = String(e);
    }
    console.warn(`[${label}] attempt ${attempt + 1}/${delaysMs.length} failed — ${lastErr}`);
  }
  throw new Error(`[${label}] Failed to fetch Torvik CSV from ${url}\n${lastErr}`);
}

/** Surfaces a message in the GitHub Actions run summary (plain warn locally). */
function annotate(msg: string) {
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${msg}`);
  else console.warn(`⚠️  ${msg}`);
}

function writeCsvFile(outPath: string, header: string[], rows: string[][]) {
  const out =
    header.join(",") +
    "\n" +
    rows.map((r) => r.map((x) => x ?? "").join(",")).join("\n") +
    "\n";
  fs.writeFileSync(outPath, out, "utf-8");
}

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
  powerRating?: number; // AdjEM * AdjT / 100
};

function buildTorvikByName(torvik: Parsed) {
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

  return torvikByName;
}

function applyTorvikToTeams(args: {
  baseTeamsCsvPath: string;
  torvikByName: Map<string, TorvikTeam>;
  outPath: string;
  label: string;
  /** Append Torvik teams that have no row yet (new D1 members). */
  addNewTeams?: boolean;
}) {
  const { baseTeamsCsvPath, torvikByName, outPath, label, addNewTeams } = args;

  if (!fs.existsSync(baseTeamsCsvPath))
    throw new Error(`Missing ${baseTeamsCsvPath}`);

  const teamsRaw = fs.readFileSync(baseTeamsCsvPath, "utf-8");
  const teams = parseCsv(teamsRaw);

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
  const matchedTorvik = new Set<TorvikTeam>();

  for (const row of teams.rows) {
    const teamId = (row[iTeamId] ?? "").trim();
    const teamName = (row[iTeamName] ?? "").trim();
    if (!teamId || !teamName) continue;

    let hit: TorvikTeam | undefined;

    for (const cand of nameCandidates(teamName)) {
      hit = torvikByName.get(norm(cand));
      if (hit) break;
    }

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

    matchedTorvik.add(hit);
    // Keep conference current — realignment moves dozens of teams a year.
    if (iConf >= 0 && hit.conf) row[iConf] = hit.conf;

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

  // New D1 members: in Torvik's file but not in ours. Without a row their
  // games are silently dropped from the slate, so add them here.
  const added: Array<{ teamId: string; teamName: string }> = [];
  if (addNewTeams) {
    const iHca = idx(teams.header, "hca");
    const iHcaNote = idx(teams.header, "hca_note");
    const existingIds = new Set(teams.rows.map((r) => (r[iTeamId] ?? "").trim()));
    for (const t of torvikByName.values()) {
      if (matchedTorvik.has(t)) continue;
      const teamId = torvikSlugId(t.name);
      if (existingIds.has(teamId)) continue; // id exists under another name — leave for a human
      const row = teams.header.map(() => "");
      row[iTeamId] = teamId;
      row[iTeamName] = t.name;
      if (iConf >= 0) row[iConf] = t.conf ?? "";
      if (iHca >= 0) row[iHca] = String(DEFAULT_HCA);
      if (iHcaNote >= 0) row[iHcaNote] = `default HCA=${DEFAULT_HCA.toFixed(1)} (new team ${YEAR})`;
      row[oPR] = t.powerRating != null ? String(t.powerRating) : "0";
      row[oAdjO] = t.adjO != null ? String(t.adjO) : "";
      row[oAdjD] = t.adjD != null ? String(t.adjD) : "";
      row[oTempo] = t.adjT != null ? String(t.adjT) : "";
      row[oBarthag] = t.barthag != null ? String(t.barthag) : "";
      row[oRank] = t.rank != null ? String(Math.round(t.rank)) : "";
      row[oOERank] = t.oeRank != null ? String(Math.round(t.oeRank)) : "";
      row[oDERank] = t.deRank != null ? String(Math.round(t.deRank)) : "";
      row[oW] = t.w != null ? String(t.w) : "";
      row[oL] = t.l != null ? String(t.l) : "";
      teams.rows.push(row);
      existingIds.add(teamId);
      added.push({ teamId, teamName: t.name });
    }
  }

  writeCsvFile(outPath, teams.header, teams.rows);

  if (added.length) {
    ensureAliases(added);
    for (const a of added) {
      annotate(
        `New team added from Torvik: ${a.teamName} (${a.teamId}). ` +
          `Check its sportsbook alias in teamAliases.csv and add its ESPN id to espnMasterMap.ts.`
      );
    }
  }

  console.log(`✅ [${label}] Wrote: ${outPath}`);
  console.log(`Rows: ${teams.rows.length}`);

  if (misses.length) {
    console.warn(`⚠️ [${label}] Torvik match misses (${misses.length}):`);
    for (const m of misses.slice(0, 25)) {
      console.warn(`  - ${m.teamId} | ${m.teamName}`);
    }
    if (misses.length > 25) console.warn(`  ...and ${misses.length - 25} more`);
    console.warn(
      `Add synonyms in TORVIK_SYNONYMS in this script for the misses above.`
    );
    // These rows keep whatever ratings they had before, i.e. they go stale.
    annotate(
      `[${label}] ${misses.length} team(s) in teams.csv not found in Torvik ${YEAR} ` +
        `(ratings NOT updated): ${misses.slice(0, 10).map((m) => m.teamName).join(", ")}. ` +
        `Remove the row if the team left D1, or add a synonym if it was renamed.`
    );
  }
}

const DEFAULT_HCA = 3; // league-average home-court advantage, in points

function torvikSlugId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `team-${slug}`;
}

/** Make sure each new team has at least its plain name in teamAliases.csv. */
function ensureAliases(added: Array<{ teamId: string; teamName: string }>) {
  const aliasPath = path.join(process.cwd(), "src", "data", LEAGUE, "teamAliases.csv");
  if (!fs.existsSync(aliasPath)) return;
  const raw = fs.readFileSync(aliasPath, "utf-8");
  const have = new Set(
    raw.split(/\r?\n/).map((l) => l.split(",")[0]?.trim()).filter(Boolean)
  );
  const lines = added
    .filter((a) => !have.has(a.teamId) && !a.teamName.includes(","))
    .map((a) => `${a.teamId},${a.teamName}`);
  if (!lines.length) return;
  fs.writeFileSync(aliasPath, raw.replace(/\n*$/, "\n") + lines.join("\n") + "\n", "utf-8");
  console.log(`✅ Added ${lines.length} alias row(s) to ${aliasPath}`);
}

/**
 * Bootstrap teams.csv from scratch using only Torvik data.
 * Used when the file is empty (new league setup). Generates a teamId slug
 * from the Torvik team name and writes one row per team.
 * HCA defaults to 0 for NCAAW (neutral sites during tournament season) or 3 for NCAAM.
 */
function bootstrapTeamsCsv(
  torvikByName: Map<string, TorvikTeam>,
  outPath: string
) {
  const header = [
    "teamId",
    "teamName",
    "conference",
    "powerRating",
    "hca",
    "adjO",
    "adjD",
    "tempo",
    "barthag",
    "torvikRank",
    "torvikOeRank",
    "torvikDeRank",
    "wins",
    "losses",
  ];

  const rows: string[][] = [];

  for (const [, t] of torvikByName.entries()) {
    const teamId = torvikSlugId(t.name);

    rows.push([
      teamId,
      t.name,
      t.conf ?? "",
      t.powerRating != null ? String(t.powerRating) : "0",
      String(DEFAULT_HCA),
      t.adjO != null ? String(t.adjO) : "",
      t.adjD != null ? String(t.adjD) : "",
      t.adjT != null ? String(t.adjT) : "",
      t.barthag != null ? String(t.barthag) : "",
      t.rank != null ? String(t.rank) : "",
      t.oeRank != null ? String(t.oeRank) : "",
      t.deRank != null ? String(t.deRank) : "",
      t.w != null ? String(t.w) : "",
      t.l != null ? String(t.l) : "",
    ]);
  }

  // Sort by power rating descending
  rows.sort((a, b) => Number(b[3] ?? 0) - Number(a[3] ?? 0));

  writeCsvFile(outPath, header, rows);
  console.log(`✅ [BOOTSTRAP] Wrote ${rows.length} teams to ${outPath}`);
}

async function main() {
  console.log(`🏀 Updating Torvik ratings for league: ${LEAGUE}, season ${YEAR}`);

  // 1) Overall (existing behavior)
  const overallRaw = await readTorvikCsv({
    localPath: TORVIK_LOCAL,
    url: TORVIK_URL,
    label: "OVERALL",
  });
  const overall = parseCsv(overallRaw);
  const overallByName = buildTorvikByName(overall);

  // Bootstrap: if teams.csv is empty, seed it from Torvik instead of merging
  const existingCsv = parseCsv(fs.readFileSync(TEAMS_CSV, "utf-8"));
  if (existingCsv.rows.length === 0) {
    console.log(
      `ℹ️ teams.csv is empty — bootstrapping from Torvik (${overallByName.size} teams)`
    );
    bootstrapTeamsCsv(overallByName, OUT_OVERALL);
  } else {
    applyTorvikToTeams({
      baseTeamsCsvPath: TEAMS_CSV,
      torvikByName: overallByName,
      outPath: OUT_OVERALL,
      label: "OVERALL",
      addNewTeams: true,
    });
  }
  console.log(`Torvik OVERALL URL: ${TORVIK_URL}`);

  // 2) Home split (optional until you set URLs)
  if (TORVIK_HOME_LOCAL || TORVIK_HOME_URL) {
    const homeRaw = await readTorvikCsv({
      localPath: TORVIK_HOME_LOCAL,
      url: TORVIK_HOME_URL,
      label: "HOME",
    });
    const home = parseCsv(homeRaw);
    const homeByName = buildTorvikByName(home);
    applyTorvikToTeams({
      baseTeamsCsvPath: TEAMS_CSV,
      torvikByName: homeByName,
      outPath: OUT_HOME,
      label: "HOME",
    });
    console.log(`Torvik HOME URL: ${TORVIK_HOME_URL ?? "(local file)"}`);
  } else {
    console.log(
      "ℹ️ Skipping HOME split (set TORVIK_HOME_URL or TORVIK_HOME_LOCAL to enable)."
    );
  }

  // 3) Away split (optional until you set URLs)
  if (TORVIK_AWAY_LOCAL || TORVIK_AWAY_URL) {
    const awayRaw = await readTorvikCsv({
      localPath: TORVIK_AWAY_LOCAL,
      url: TORVIK_AWAY_URL,
      label: "AWAY",
    });
    const away = parseCsv(awayRaw);
    const awayByName = buildTorvikByName(away);
    applyTorvikToTeams({
      baseTeamsCsvPath: TEAMS_CSV,
      torvikByName: awayByName,
      outPath: OUT_AWAY,
      label: "AWAY",
    });
    console.log(`Torvik AWAY URL: ${TORVIK_AWAY_URL ?? "(local file)"}`);
  } else {
    console.log(
      "ℹ️ Skipping AWAY split (set TORVIK_AWAY_URL or TORVIK_AWAY_LOCAL to enable)."
    );
  }

  // ---- Dual-write team rating snapshot to DB (best-effort) ----
  if (process.env.POSTGRES_URL) {
    try {
      const { syncTeamRatingsToDb } = await import("@/db/dailySync");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
        .format(new Date())
        .slice(0, 10);
      const teamsRaw = fs.readFileSync(TEAMS_CSV, "utf-8");
      const updatedTeams = parseCsv(teamsRaw);
      const iId     = idx(updatedTeams.header, "teamId");
      const iName   = idx(updatedTeams.header, "teamName") >= 0
        ? idx(updatedTeams.header, "teamName")
        : idx(updatedTeams.header, "name");
      const iConf   = idx(updatedTeams.header, "conference");
      const iPR     = idx(updatedTeams.header, "powerRating");
      const iHca    = idx(updatedTeams.header, "hca");
      const iAdjO   = idx(updatedTeams.header, "adjO");
      const iAdjD   = idx(updatedTeams.header, "adjD");
      const iTempo  = idx(updatedTeams.header, "tempo");
      const iBarthag = idx(updatedTeams.header, "barthag");
      const iRank   = idx(updatedTeams.header, "torvikRank");
      const iW      = idx(updatedTeams.header, "wins");
      const iL      = idx(updatedTeams.header, "losses");

      const snapshots = updatedTeams.rows
        .filter((r) => r[iId] && r[iName])
        .map((r) => ({
          teamId:      r[iId],
          teamName:    r[iName],
          conference:  iConf >= 0 ? (r[iConf] || null) : null,
          wins:        iW >= 0 && r[iW] ? Number(r[iW]) : null,
          losses:      iL >= 0 && r[iL] ? Number(r[iL]) : null,
          powerRating: iPR >= 0 && r[iPR] ? Number(r[iPR]) : null,
          hca:         iHca >= 0 && r[iHca] ? Number(r[iHca]) : null,
          adjO:        iAdjO >= 0 && r[iAdjO] ? Number(r[iAdjO]) : null,
          adjD:        iAdjD >= 0 && r[iAdjD] ? Number(r[iAdjD]) : null,
          tempo:       iTempo >= 0 && r[iTempo] ? Number(r[iTempo]) : null,
          barthag:     iBarthag >= 0 && r[iBarthag] ? Number(r[iBarthag]) : null,
          torvikRank:  iRank >= 0 && r[iRank] ? Number(r[iRank]) : null,
        }));

      await syncTeamRatingsToDb(LEAGUE, today, snapshots);
      console.log(`✅ DB sync: ${snapshots.length} team rating snapshot(s) for ${today}`);
    } catch (err) {
      console.warn("⚠️  DB sync failed (CSV file is unaffected):", err);
    }
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
