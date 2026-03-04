// src/scripts/backfillRange.ts
//
// Backfills opener snapshots, closing lines, and results for a range of past dates.
// Each date makes ~3 TheOddsAPI calls (1 opener + 2 closing snapshots).
// Results come from ESPN (free, no API key).
//
// Usage:
//   FROM=2026-02-24 TO=2026-03-01 THE_ODDS_API_KEY=xxx npx tsx src/scripts/backfillRange.ts
//
// Options:
//   FROM          Start date inclusive (YYYY-MM-DD). Default: 7 days ago.
//   TO            End date inclusive (YYYY-MM-DD). Default: yesterday.
//   DRY_RUN=1     Print what would run without hitting the API.
//   FORCE=1       Overwrite existing opener snapshots (passed through to opener script).
//
// Safety:
//   - Opener script skips if snapshot already exists (unless FORCE=1).
//   - Closing lines script merges into existing file (safe to re-run).
//   - Results script overwrites (ESPN data, free).
//   - 1-second delay between API calls to be a good citizen.

import { execSync } from "node:child_process";
import path from "node:path";

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
if (!ODDS_API_KEY) throw new Error("Missing THE_ODDS_API_KEY env var");

const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE   = process.env.FORCE   === "1";
const LEAGUE  = process.env.LEAGUE ?? "ncaam";

// ---- date helpers ----
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = from;
  while (cur <= to) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

// Opening lines snapshot: ~11am ET = 16:00 UTC
// Using 16:05 to give a little breathing room past the hour.
function openerSnapshotTime(date: string): string {
  return `${date}T16:05:00Z`;
}

// Closing lines: two snapshots per day
// Noon close: 16:55 UTC (captures games that close ~noon ET)
// Evening close: 23:55 UTC (captures rest of the slate)
function closingSnapshotTimes(date: string): string[] {
  return [`${date}T16:55:00Z`, `${date}T23:55:00Z`];
}

// ---- runner ----
function run(cmd: string, env: Record<string, string> = {}, allowExitCode = 0) {
  const fullEnv = { ...process.env, ...env } as NodeJS.ProcessEnv;
  const envStr = Object.entries(env)
    .filter(([k]) => k !== "THE_ODDS_API_KEY") // don't log the key
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`  $ ${envStr} ${cmd.replace(/node_modules\/.bin\/tsx/, "tsx")}`);
  if (DRY_RUN) return;
  try {
    execSync(cmd, { stdio: "inherit", env: fullEnv });
  } catch (e: any) {
    // Exit code 2 = unmapped teams warning — script still wrote its output file.
    if (e?.status === 2 && allowExitCode === 2) {
      console.log("  ⚠️  Some teams unmapped (exit 2) — continuing");
      return;
    }
    throw e;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- main ----
async function main() {
  const from = process.env.FROM || daysAgo(7);
  const to   = process.env.TO   || daysAgo(1);
  const dates = dateRange(from, to);

  console.log(`\n🏀 Backfilling ${dates.length} date(s): ${from} → ${to}`);
  if (DRY_RUN) console.log("   (DRY_RUN=1 — no API calls will be made)\n");
  if (FORCE)   console.log("   (FORCE=1 — existing opener snapshots will be overwritten)\n");

  // Use the local tsx binary so the script works regardless of whether
  // nvm/npx is activated in the current shell environment.
  const tsx = `${process.execPath} ${path.join(process.cwd(), "node_modules/.bin/tsx")}`;

  for (const date of dates) {
    console.log(`\n── ${date} ──────────────────────────────────`);

    // 1. Opener snapshot (historical endpoint at ~11am ET)
    console.log("  [1/4] Opener snapshot (historical)");
    run(`${tsx} src/scripts/fetchOddsOpenersForDate.ts`, {
      DATE: date,
      SNAPSHOT_TIME: openerSnapshotTime(date),
      THE_ODDS_API_KEY: ODDS_API_KEY!,
      LEAGUE,
      ...(FORCE ? { FORCE: "1" } : {}),
    }, 2 /* allow exit 2 = unmapped teams warning */);
    if (!DRY_RUN) await sleep(1000);

    // 2. Closing lines — noon snapshot
    console.log("  [2/4] Closing lines (noon snapshot)");
    run(`${tsx} src/scripts/fetchClosingLines.ts`, {
      DATE: date,
      SNAPSHOT_TIME: closingSnapshotTimes(date)[0],
      THE_ODDS_API_KEY: ODDS_API_KEY!,
      LEAGUE,
    });
    if (!DRY_RUN) await sleep(1000);

    // 3. Closing lines — evening snapshot
    console.log("  [3/4] Closing lines (evening snapshot)");
    run(`${tsx} src/scripts/fetchClosingLines.ts`, {
      DATE: date,
      SNAPSHOT_TIME: closingSnapshotTimes(date)[1],
      THE_ODDS_API_KEY: ODDS_API_KEY!,
      LEAGUE,
    });
    if (!DRY_RUN) await sleep(1000);

    // 4. Results from ESPN (free, no API key needed)
    console.log("  [4/4] Game results (ESPN)");
    run(`${tsx} src/scripts/fetchGameResults.ts`, {
      DATE: date,
      LEAGUE,
    });
    if (!DRY_RUN) await sleep(500);
  }

  console.log(`\n✅ Backfill complete: ${dates.length} date(s) processed`);
  if (DRY_RUN) {
    console.log("   Re-run without DRY_RUN=1 to execute for real.");
  } else {
    console.log("   Commit the new files in src/data/ to save them.");
  }
}

main().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});
