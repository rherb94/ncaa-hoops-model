// src/scripts/recomputeModel.ts
//
// Re-computes model fields (modelSpread, edge, signal) for existing opener
// snapshots using the current teams.csv efficiency ratings and formula.
// Makes ZERO API calls — reads only local files.
//
// Use this whenever you change:
//   - The HCA formula (e.g. tweak the +1 adjustment)
//   - The efficiency model logic in src/lib/model.ts
//   - Team ratings in teams.csv (after running updateTeamsFromTorvik)
//
// Usage:
//   npx tsx src/scripts/recomputeModel.ts                    # all dates
//   DATE=2026-02-24 npx tsx src/scripts/recomputeModel.ts   # single date
//   DRY_RUN=1 npx tsx src/scripts/recomputeModel.ts         # preview changes only
//
// The script overwrites only the model.* fields in each game; all other
// fields (opening line, ESPN IDs, neutral site, etc.) are preserved.

import fs from "node:fs";
import path from "node:path";
import { loadTeams } from "@/data/teams";
import { resolveTeamId } from "@/data/teamAliases";
import type { LeagueId } from "@/lib/leagues";
import {
  computeEfficiencyModel,
  computeModelSpread,
  computeEdge,
  computeSignal,
} from "@/lib/model";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const DRY_RUN = process.env.DRY_RUN === "1";
const DATE    = process.env.DATE || "";
const LEAGUE  = process.env.LEAGUE || "ncaam"; // use || so empty string also falls back

const OPEN_DIR = path.join(process.cwd(), "src", "data", LEAGUE, "odds_opening");

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function saveJson(p: string, obj: unknown) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

type SnapshotGame = {
  oddsEventId: string;
  home_team: string;
  away_team: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  neutralSite?: boolean;
  opening: { homePoint: number; awayPoint: number; book: string; last_update: string } | null;
  model: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    modelSpread: number | null;
    edge: number | null;
    signal: string;
  } | null;
  [key: string]: unknown;
};

type SnapshotFile = {
  date: string;
  captured_at: string;
  games: SnapshotGame[];
};

function recomputeGame(
  g: SnapshotGame,
  teamsMap: ReturnType<typeof loadTeams>
): { changed: boolean; oldModel: unknown; newModel: unknown } {
  const homeTeamId = resolveTeamId({ provider: "theoddsapi", teamName: g.home_team, league: LEAGUE as LeagueId });
  const awayTeamId = resolveTeamId({ provider: "theoddsapi", teamName: g.away_team, league: LEAGUE as LeagueId });
  const homeTeam   = homeTeamId ? teamsMap.get(homeTeamId) : undefined;
  const awayTeam   = awayTeamId ? teamsMap.get(awayTeamId) : undefined;

  if (!homeTeam || !awayTeam || !g.opening?.homePoint == null) {
    return { changed: false, oldModel: g.model, newModel: g.model };
  }

  const neutralSite = g.neutralSite ?? false;
  const hca = neutralSite ? 0 : (homeTeam.hca ?? 2);
  const eff = computeEfficiencyModel(homeTeam, awayTeam, hca);

  const rawModelSpread =
    eff?.modelSpread ??
    computeModelSpread(homeTeam.powerRating, awayTeam.powerRating, hca);

  const marketSpread = g.opening?.homePoint;
  const edgeRaw      = computeEdge(rawModelSpread, marketSpread);
  const edge         = edgeRaw === undefined ? null : clamp(edgeRaw, -12, 12);
  const signal       = computeSignal(edge ?? undefined);

  const newModel = {
    homeTeamId: homeTeamId ?? null,
    awayTeamId: awayTeamId ?? null,
    modelSpread: rawModelSpread,
    edge,
    signal,
  };

  const changed =
    JSON.stringify(newModel) !== JSON.stringify(g.model);

  return { changed, oldModel: g.model, newModel };
}

async function processFile(filePath: string, teamsMap: ReturnType<typeof loadTeams>) {
  const snap = loadJson<SnapshotFile>(filePath);
  let changes = 0;

  for (const g of snap.games) {
    const { changed, oldModel, newModel } = recomputeGame(g, teamsMap);
    if (changed) {
      changes++;
      const old = oldModel as any;
      const neu = newModel as any;
      console.log(
        `  ~ ${g.away_team} @ ${g.home_team}: ` +
        `spread ${old?.modelSpread} → ${neu?.modelSpread}, ` +
        `edge ${old?.edge} → ${neu?.edge}, ` +
        `signal ${old?.signal} → ${neu?.signal}`
      );
      if (!DRY_RUN) {
        g.model = newModel as SnapshotGame["model"];
      }
    }
  }

  if (changes > 0 && !DRY_RUN) {
    saveJson(filePath, snap);
  }

  return changes;
}

async function main() {
  const teamsMap = loadTeams(LEAGUE as LeagueId);
  console.log(`Loaded ${teamsMap.size} teams from teams.csv`);
  if (DRY_RUN) console.log("DRY_RUN=1 — no files will be written\n");

  // Collect files to process
  const files: string[] = DATE
    ? [path.join(OPEN_DIR, `${DATE}.json`)]
    : fs
        .readdirSync(OPEN_DIR)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .map((f) => path.join(OPEN_DIR, f));

  let totalChanges = 0;
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${filePath}`);
      continue;
    }
    const date = path.basename(filePath, ".json");
    console.log(`\n── ${date}`);
    const n = await processFile(filePath, teamsMap);
    if (n === 0) console.log("  (no changes)");
    totalChanges += n;
  }

  console.log(
    `\n✅ Done. ${totalChanges} game(s) updated across ${files.length} file(s).`
  );
  if (DRY_RUN && totalChanges > 0) {
    console.log("   Re-run without DRY_RUN=1 to apply changes.");
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
