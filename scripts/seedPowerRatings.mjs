// scripts/seedPowerRatings.mjs
// Seed market-implied power ratings from The Odds API spreads.
// Writes/updates:
//   - src/data/teamAliases.csv  (providerTeamName -> teamId)
//   - src/data/teams.csv        (teamId -> powerRating/hca)
//
// Run:
//   THE_ODDS_API_KEY=xxx node scripts/seedPowerRatings.mjs
//
// Optional env:
//   THE_ODDS_API_REGION=us
//   THE_ODDS_API_MARKETS=spreads
//   THE_ODDS_API_ODDS_FORMAT=american
//   SEED_DATE=YYYY-MM-DD         (interpreted as America/New_York date)
//   SEED_HCA=2.0                 (default HCA used in equations)

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PROVIDER = "theoddsapi";
const ET_TZ = "America/New_York";

const API_KEY = process.env.THE_ODDS_API_KEY;
if (!API_KEY) {
  console.error("Missing env THE_ODDS_API_KEY");
  process.exit(1);
}

const REGION = process.env.THE_ODDS_API_REGION ?? "us";
const MARKETS = process.env.THE_ODDS_API_MARKETS ?? "spreads";
const ODDS_FORMAT = process.env.THE_ODDS_API_ODDS_FORMAT ?? "american";
const DEFAULT_HCA = Number(process.env.SEED_HCA ?? "2.0");

// The Odds API sport key for NCAA Men's Basketball
const SPORT_KEY = "basketball_ncaab";

function ymdETFromNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function ymdET(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const DATE = process.env.SEED_DATE ?? ymdETFromNow();

function slugifyTeamId(teamName) {
  // Deterministic internal ID (not UUID). You can rename later via aliases.
  const base = teamName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/'/g, "")
    .replace(/\./g, "")
    .replace(/[()]/g, "")
    .replace(/&/g, "and")
    .trim()
    .toLowerCase();

  const slug = base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `team-${slug}`;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return { header: null, rows: [] };
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return { header: null, rows: [] };
  const lines = raw.split("\n");
  const header = lines[0];
  const rows = lines.slice(1).filter(Boolean).map((l) => l.split(","));
  return { header, rows };
}

function writeCsv(filePath, header, rows) {
  const out = [header, ...rows.map((r) => r.join(","))].join("\n") + "\n";
  fs.writeFileSync(filePath, out, "utf-8");
}

async function fetchOdds() {
  const url =
    `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds` +
    `?regions=${encodeURIComponent(REGION)}` +
    `&markets=${encodeURIComponent(MARKETS)}` +
    `&oddsFormat=${encodeURIComponent(ODDS_FORMAT)}` +
    `&apiKey=${encodeURIComponent(API_KEY)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TheOddsAPI error ${res.status}: ${text}`);
  }
  return res.json();
}

function extractHomeSpreadFromEvent(event) {
  // Pull first available HOME spread point (negative means home favored).
  const home = event.home_team;
  const away = event.away_team;

  for (const b of event.bookmakers ?? []) {
    for (const m of b.markets ?? []) {
      if (m.key !== "spreads") continue;

      const homeOutcome = m.outcomes?.find((o) => o.name === home);
      const awayOutcome = m.outcomes?.find((o) => o.name === away);

      if (homeOutcome?.point !== undefined && Number.isFinite(homeOutcome.point)) {
        return Number(homeOutcome.point);
      }
      // If only away has point, infer home point (away is opposite sign)
      if (awayOutcome?.point !== undefined && Number.isFinite(awayOutcome.point)) {
        return -Number(awayOutcome.point);
      }
    }
  }

  return undefined;
}

/**
 * Solve ratings from linear equations via a simple least-squares normal equation:
 * We build equations of form:
 *   r_home - r_away = target
 * where target = (-homeSpread) - HCA
 *
 * We anchor the first team to rating 0 to avoid singular matrix.
 *
 * Returns Map(teamId -> rating)
 */
function solveRatings(teamIds, equations) {
  const ids = [...teamIds];
  const n = ids.length;
  if (n === 0) return new Map();

  // Anchor ids[0] = 0, solve for remaining n-1 variables
  const varIds = ids.slice(1);
  const m = varIds.length;

  // Build normal equations: (A^T A) x = (A^T b)
  // Each equation is sparse with +1 for home, -1 for away.
  // We'll build ATA (m x m) and ATb (m).
  const ATA = Array.from({ length: m }, () => Array.from({ length: m }, () => 0));
  const ATb = Array.from({ length: m }, () => 0);

  const idx = new Map(varIds.map((id, i) => [id, i]));

  for (const eq of equations) {
    const { homeId, awayId, target } = eq;

    // Row vector a has:
    // a[home] += 1, a[away] += -1, except anchored team removed.
    const terms = [];
    if (homeId !== ids[0]) terms.push({ i: idx.get(homeId), v: 1 });
    if (awayId !== ids[0]) terms.push({ i: idx.get(awayId), v: -1 });

    // If both were anchored (unlikely), skip
    if (terms.length === 0) continue;

    // Update ATA and ATb
    for (const t1 of terms) {
      ATb[t1.i] += t1.v * target;
      for (const t2 of terms) {
        ATA[t1.i][t2.i] += t1.v * t2.v;
      }
    }
  }

  // Solve linear system ATA x = ATb using Gaussian elimination
  const x = gaussianSolve(ATA, ATb);

  const result = new Map();
  result.set(ids[0], 0);
  for (let i = 0; i < m; i++) {
    result.set(varIds[i], x[i] ?? 0);
  }
  return result;
}

function gaussianSolve(A, b) {
  const n = b.length;
  // Make augmented matrix
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Find pivot
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-9) continue;

    // Swap
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }

    // Normalize pivot row
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;

    // Eliminate
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  // Extract solution
  return M.map((row) => row[n]);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function main() {
  console.log(`Seeding market-implied ratings for date (ET): ${DATE}`);
  const events = await fetchOdds();

  // Filter events by ET date
  const todays = events.filter((e) => ymdET(e.commence_time) === DATE);

  console.log(`Odds API events returned: ${events.length}`);
  console.log(`Events matching ${DATE} (ET): ${todays.length}`);

  // Build team set + equations
  const teamNameToId = new Map(); // provider team name -> teamId
  const equations = []; // {homeId, awayId, target}

  for (const e of todays) {
    const homeName = e.home_team;
    const awayName = e.away_team;

    const homeId = teamNameToId.get(homeName) ?? slugifyTeamId(homeName);
    const awayId = teamNameToId.get(awayName) ?? slugifyTeamId(awayName);

    teamNameToId.set(homeName, homeId);
    teamNameToId.set(awayName, awayId);

    const homeSpread = extractHomeSpreadFromEvent(e);
    if (homeSpread === undefined) continue;

    // Model convention: spread is homeSpread (negative home favored)
    // Equation we want: r_home - r_away = (-homeSpread) - HCA
    const target = (-homeSpread) - DEFAULT_HCA;

    equations.push({ homeId, awayId, target });
  }

  const teamIds = new Set(teamNameToId.values());

  console.log(`Teams discovered: ${teamIds.size}`);
  console.log(`Equations used (games w/ spreads): ${equations.length}`);

  if (equations.length < 2) {
    console.warn("Not enough games with spreads to seed ratings meaningfully. Try later or expand region/markets.");
  }

  const ratings = solveRatings(teamIds, equations);

  // --- Update teamAliases.csv ---
  const aliasesPath = path.join(ROOT, "src", "data", "teamAliases.csv");
  ensureDir(path.dirname(aliasesPath));

  const aliasHeader = "provider,providerTeamName,teamId";
  const { rows: aliasRows } = readCsv(aliasesPath);

  const aliasSet = new Set(aliasRows.map((r) => r.join(",")));

  let aliasesAdded = 0;
  for (const [teamName, teamId] of teamNameToId.entries()) {
    const row = [PROVIDER, teamName, teamId];
    const key = row.join(",");
    if (!aliasSet.has(key)) {
      aliasRows.push(row);
      aliasSet.add(key);
      aliasesAdded++;
    }
  }

  // Sort aliases for cleanliness
  aliasRows.sort((a, b) => a[1].localeCompare(b[1]));

  writeCsv(aliasesPath, aliasHeader, aliasRows);
  console.log(`teamAliases.csv: added ${aliasesAdded} rows`);

  // --- Update teams.csv ---
  const teamsPath = path.join(ROOT, "src", "data", "teams.csv");
  ensureDir(path.dirname(teamsPath));

  // We won't assume your exact schema beyond having these required columns:
  // teamId,teamName,conference,powerRating,hca
  const teamsHeader = "teamId,teamName,conference,powerRating,hca";
  const existing = readCsv(teamsPath);

  let teamsRows = existing.rows;
  let header = existing.header ?? teamsHeader;

  // If file exists with different header, we won't rewrite it; we’ll try to update by known columns.
  const cols = header.split(",");
  const idxTeamId = cols.indexOf("teamId");
  const idxTeamName = cols.indexOf("teamName");
  const idxConf = cols.indexOf("conference");
  const idxPR = cols.indexOf("powerRating");
  const idxHca = cols.indexOf("hca");

  if (idxTeamId === -1 || idxTeamName === -1 || idxPR === -1 || idxHca === -1) {
    console.error(
      `teams.csv header must include teamId, teamName, powerRating, hca. Your header is:\n${header}`
    );
    process.exit(1);
  }

  const teamsById = new Map(teamsRows.map((r) => [r[idxTeamId], r]));

  let teamsAdded = 0;
  let teamsUpdated = 0;

  for (const [teamName, teamId] of teamNameToId.entries()) {
    const pr = ratings.get(teamId) ?? 0;
    const prRounded = (Math.round(pr * 10) / 10).toFixed(1);

    if (!teamsById.has(teamId)) {
      const row = Array.from({ length: cols.length }, () => "");
      row[idxTeamId] = teamId;
      row[idxTeamName] = teamName;
      if (idxConf !== -1) row[idxConf] = ""; // fill later
      row[idxPR] = prRounded;
      row[idxHca] = String(DEFAULT_HCA);
      teamsRows.push(row);
      teamsById.set(teamId, row);
      teamsAdded++;
    } else {
      const row = teamsById.get(teamId);

      // Only set name if empty
      if (!row[idxTeamName]) row[idxTeamName] = teamName;

      // Only set PR if empty or 0 (so you can override manually later)
      const existingPR = Number(row[idxPR] || "0");
      if (!Number.isFinite(existingPR) || existingPR === 0) {
        row[idxPR] = prRounded;
        teamsUpdated++;
      }

      // Only set HCA if empty
      if (!row[idxHca]) row[idxHca] = String(DEFAULT_HCA);
    }
  }

  // Sort teams by teamName for sanity (if teamName column exists)
  teamsRows.sort((a, b) => (a[idxTeamName] || "").localeCompare(b[idxTeamName] || ""));

  // If file didn't exist, set header to our default
  if (!existing.header) header = teamsHeader;

  writeCsv(teamsPath, header, teamsRows);
  console.log(`teams.csv: added ${teamsAdded} rows, updated PR for ${teamsUpdated} rows`);

  console.log("Done. Restart `npm run dev` and refresh /slate.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});