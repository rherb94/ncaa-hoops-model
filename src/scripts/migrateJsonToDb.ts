// src/scripts/migrateJsonToDb.ts
// One-time seed: imports all existing JSON data (odds_opening, closing_lines,
// results) into Vercel Postgres via Drizzle ORM.
//
// Run:  npm run db:seed
// Or:   LEAGUE=ncaam tsx src/scripts/migrateJsonToDb.ts
//       LEAGUE=ncaaw tsx src/scripts/migrateJsonToDb.ts
//
// The script is IDEMPOTENT — it skips rows that already exist (by unique key).
// Safe to run multiple times; only new rows are inserted.
//
// Requires POSTGRES_URL env var (set in .env.local or CI secrets).

// Load .env.local (tsx doesn't auto-load it the way Next.js does)
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql as pgSql } from "@vercel/postgres";
import { eq } from "drizzle-orm";
import { ncaam, ncaaw } from "@/db/schema";
import { loadTeams } from "@/data/teams";
import type { LeagueId } from "@/lib/leagues";

// ---- config ----------------------------------------------------------------

const LEAGUES_TO_MIGRATE: LeagueId[] = (process.env.LEAGUE
  ? [process.env.LEAGUE as LeagueId]
  : ["ncaam", "ncaaw"]);

const DATA_DIR = path.join(process.cwd(), "src", "data");
const LIVE_FROM = "2026-03-02";

// ---- DB client -------------------------------------------------------------

const db = drizzle(pgSql);

// ---- schema map by league --------------------------------------------------

const schemaMap = { ncaam, ncaaw };

// ---- helpers ---------------------------------------------------------------

function loadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function allDates(leagueId: string): string[] {
  const d = path.join(DATA_DIR, leagueId, "odds_opening");
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

function evaluatePick(
  signal: string,
  edge: number | null,
  openingHomePoint: number | null,
  actualSpread: number | null
): "WIN" | "LOSS" | "PUSH" | "PENDING" | null {
  if (signal === "NONE" || edge === null) return null;
  if (actualSpread === null || openingHomePoint === null) return "PENDING";
  const pickSide = edge < 0 ? "HOME" : "AWAY";
  const margin = actualSpread - openingHomePoint;
  if (Math.abs(margin) < 0.01) return "PUSH";
  const homeCovered = margin < 0;
  if (pickSide === "HOME") return homeCovered ? "WIN" : "LOSS";
  return homeCovered ? "LOSS" : "WIN";
}

function computeClv(
  openingHomePoint: number | null,
  closingHomePoint: number | null,
  edge: number | null
): number | null {
  if (openingHomePoint === null || closingHomePoint === null || !edge) return null;
  const pickSide = edge < 0 ? "HOME" : "AWAY";
  const raw = openingHomePoint - closingHomePoint;
  return pickSide === "HOME" ? raw : -raw;
}

// ---- snapshot JSON types ---------------------------------------------------

type SnapshotGame = {
  oddsEventId: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  home_espnTeamId?: string | null;
  away_espnTeamId?: string | null;
  neutralSite?: boolean;
  opening: {
    book?: string;
    homePoint: number;
    awayPoint: number;
  } | null;
  model: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    modelSpread: number | null;
    rawModelSpread?: number | null;
    edge: number | null;
    signal: string;
  } | null;
};

type ResultGame = {
  espnEventId?: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  actualSpread: number | null;
  winner: "HOME" | "AWAY" | "TIE" | null;
};

type ClosingGame = {
  oddsEventId: string;
  homePoint: number | null;
  awayPoint: number | null;
  book?: string | null;
  snapshotTime?: string;
};

// ---- migration logic -------------------------------------------------------

async function migrateLeague(leagueId: LeagueId) {
  const tables = schemaMap[leagueId];
  const teamsMap = loadTeams(leagueId);

  const confByTorvikId = new Map<string, string>();
  for (const [id, t] of teamsMap.entries()) {
    if (t.conference) confByTorvikId.set(id, t.conference);
  }

  const dates = allDates(leagueId);
  console.log(`\n=== ${leagueId.toUpperCase()} — ${dates.length} dates ===`);

  let totalGames = 0, totalPreds = 0, totalClosing = 0, totalResults = 0, totalEvals = 0;
  let skippedGames = 0;

  for (const date of dates) {
    const isBackfilled = date < LIVE_FROM;

    const snap = loadJson<{ captured_at: string; games: SnapshotGame[] }>(
      path.join(DATA_DIR, leagueId, "odds_opening", `${date}.json`)
    );
    if (!snap) continue;

    const resFile = loadJson<{ fetched_at?: string; games: ResultGame[] }>(
      path.join(DATA_DIR, leagueId, "results", `${date}.json`)
    );
    const closeFile = loadJson<{ games: ClosingGame[] }>(
      path.join(DATA_DIR, leagueId, "closing_lines", `${date}.json`)
    );

    // Index results by ESPN team ID pair
    const resultByTeams = new Map<string, ResultGame>();
    for (const g of resFile?.games ?? []) {
      if (g.home_espnTeamId && g.away_espnTeamId) {
        resultByTeams.set(`${g.home_espnTeamId}|${g.away_espnTeamId}`, g);
      }
    }

    // Index closing lines by oddsEventId
    const closingByEventId = new Map<string, ClosingGame>();
    for (const g of closeFile?.games ?? []) {
      if (g.oddsEventId) closingByEventId.set(g.oddsEventId, g);
    }

    for (const sg of snap.games) {
      // ---- 1. Insert game (skip if already exists) ----
      const existingGames = await db
        .select({ id: tables.games.id })
        .from(tables.games)
        .where(eq(tables.games.oddsEventId, sg.oddsEventId))
        .limit(1);

      let gameId: number;
      if (existingGames.length > 0) {
        gameId = existingGames[0].id;
        skippedGames++;
      } else {
        const homeConf = sg.model?.homeTeamId
          ? confByTorvikId.get(sg.model.homeTeamId)
          : undefined;
        const awayConf = sg.model?.awayTeamId
          ? confByTorvikId.get(sg.model.awayTeamId)
          : undefined;

        const inserted = await db
          .insert(tables.games)
          .values({
            oddsEventId:     sg.oddsEventId,
            gameDate:        date,
            commenceTime:    sg.commence_time ? new Date(sg.commence_time) : undefined,
            homeTeam:        sg.home_team,
            awayTeam:        sg.away_team,
            homeTorvikId:    sg.model?.homeTeamId ?? null,
            awayTorvikId:    sg.model?.awayTeamId ?? null,
            homeEspnTeamId:  sg.home_espnTeamId ?? null,
            awayEspnTeamId:  sg.away_espnTeamId ?? null,
            homeConference:  homeConf ?? null,
            awayConference:  awayConf ?? null,
            neutralSite:     sg.neutralSite ?? false,
            backfilled:      isBackfilled,
          })
          .returning({ id: tables.games.id });

        gameId = inserted[0].id;
        totalGames++;
      }

      // ---- 2. Insert model prediction (skip if already exists for this game) ----
      if (sg.model || sg.opening) {
        const existingPred = await db
          .select({ id: tables.modelPredictions.id })
          .from(tables.modelPredictions)
          .where(eq(tables.modelPredictions.gameId, gameId))
          .limit(1);

        if (existingPred.length === 0) {
          const homeTeam = sg.model?.homeTeamId
            ? teamsMap.get(sg.model.homeTeamId)
            : undefined;
          const awayTeam = sg.model?.awayTeamId
            ? teamsMap.get(sg.model.awayTeamId)
            : undefined;

          const signal = sg.model?.signal ?? "NONE";
          const edge   = sg.model?.edge ?? null;
          const pickSide: string | null =
            signal !== "NONE" && edge !== null
              ? edge < 0 ? "HOME" : "AWAY"
              : null;

          await db.insert(tables.modelPredictions).values({
            gameId,
            capturedAt:       new Date(snap.captured_at),
            openingBook:      sg.opening?.book ?? null,
            openingHomePoint: sg.opening?.homePoint ?? null,
            openingAwayPoint: sg.opening?.awayPoint ?? null,

            // Home team ratings at capture time
            homeAdjO:         homeTeam?.adjO ?? null,
            homeAdjD:         homeTeam?.adjD ?? null,
            homeTempo:        homeTeam?.tempo ?? null,
            homeBarthag:      homeTeam?.barthag ?? null,
            homePowerRating:  homeTeam?.powerRating ?? null,
            homeHca:          homeTeam?.hca ?? null,

            // Away team ratings at capture time
            awayAdjO:         awayTeam?.adjO ?? null,
            awayAdjD:         awayTeam?.adjD ?? null,
            awayTempo:        awayTeam?.tempo ?? null,
            awayBarthag:      awayTeam?.barthag ?? null,
            awayPowerRating:  awayTeam?.powerRating ?? null,

            // Model outputs
            rawModelSpread:   sg.model?.rawModelSpread ?? sg.model?.modelSpread ?? null,
            modelSpread:      sg.model?.modelSpread ?? null,
            edge,
            signal,
            pickSide,
          });
          totalPreds++;
        }
      }

      // ---- 3. Insert closing line ----
      const closing = closingByEventId.get(sg.oddsEventId);
      if (closing) {
        const existingClose = await db
          .select({ id: tables.closingLines.id })
          .from(tables.closingLines)
          .where(eq(tables.closingLines.gameId, gameId))
          .limit(1);

        if (existingClose.length === 0) {
          await db.insert(tables.closingLines).values({
            gameId,
            snapshotTime: closing.snapshotTime
              ? new Date(closing.snapshotTime)
              : new Date(),
            book:      closing.book ?? null,
            homePoint: closing.homePoint ?? null,
            awayPoint: closing.awayPoint ?? null,
          });
          totalClosing++;
        }
      }

      // ---- 4. Insert game result ----
      const result =
        sg.home_espnTeamId && sg.away_espnTeamId
          ? resultByTeams.get(`${sg.home_espnTeamId}|${sg.away_espnTeamId}`) ?? null
          : null;

      if (result) {
        const existingResult = await db
          .select({ id: tables.gameResults.id })
          .from(tables.gameResults)
          .where(eq(tables.gameResults.gameId, gameId))
          .limit(1);

        if (existingResult.length === 0) {
          await db.insert(tables.gameResults).values({
            gameId,
            homeScore:    result.homeScore ?? null,
            awayScore:    result.awayScore ?? null,
            actualSpread: result.actualSpread ?? null,
            winner:       result.winner ?? null,
            completed:    result.completed,
            fetchedAt:    resFile?.fetched_at ? new Date(resFile.fetched_at) : new Date(),
          });
          totalResults++;
        }
      }

      // ---- 5. Insert pick evaluation ----
      const signal = sg.model?.signal ?? "NONE";
      const edge   = sg.model?.edge ?? null;
      if (signal !== "NONE" && edge !== null) {
        const existingEval = await db
          .select({ id: tables.pickEvaluations.id })
          .from(tables.pickEvaluations)
          .where(eq(tables.pickEvaluations.gameId, gameId))
          .limit(1);

        if (existingEval.length === 0) {
          const predId = (
            await db
              .select({ id: tables.modelPredictions.id })
              .from(tables.modelPredictions)
              .where(eq(tables.modelPredictions.gameId, gameId))
              .limit(1)
          )[0]?.id;

          if (predId) {
            const pickResult = evaluatePick(
              signal,
              edge,
              sg.opening?.homePoint ?? null,
              result?.actualSpread ?? null
            );

            const clv = computeClv(
              sg.opening?.homePoint ?? null,
              closing?.homePoint ?? null,
              edge
            );

            await db.insert(tables.pickEvaluations).values({
              gameId,
              predictionId:  predId,
              pickResult:    pickResult ?? "PENDING",
              clv:           clv ?? null,
            });
            totalEvals++;
          }
        }
      }
    }

    process.stdout.write(".");
  }

  console.log(`\n${leagueId}: +${totalGames} games (${skippedGames} skipped), +${totalPreds} preds, +${totalClosing} closing, +${totalResults} results, +${totalEvals} evals`);
}

// ---- main ------------------------------------------------------------------

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error(
      "Missing POSTGRES_URL env var.\n" +
      "Add it to .env.local or set it in the environment before running this script."
    );
  }

  for (const league of LEAGUES_TO_MIGRATE) {
    await migrateLeague(league);
  }

  console.log("\n✅ Migration complete.");
}

main().catch((e) => {
  console.error("❌ Migration failed:", e);
  process.exit(1);
});
