// src/scripts/snapshotIntradayPicks.ts
// Hourly script that detects new LEAN/STRONG picks from line movement.
// Fetches current odds, computes the model, and stores new picks in the DB.
// DB-only — no JSON file changes.
//
// Usage:
//   LEAGUE=ncaam npx tsx src/scripts/snapshotIntradayPicks.ts

import fs from "node:fs";
import path from "node:path";
import { TheOddsApiProvider } from "@/lib/odds/providers/theOddsApi";
import { loadTeams } from "@/data/teams";
import { getLeague } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";
import {
  computeEfficiencyModel,
  computeModelSpread,
  computeEdge,
  computeSignal,
} from "@/lib/model";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LEAGUE = (process.env.LEAGUE ?? "ncaam") as LeagueId;
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.log("No POSTGRES_URL set, skipping intraday scan.");
  process.exit(0);
}

const PREFERRED_BOOKS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "pointsbet",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(new Date())
    .slice(0, 10);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Pick the consensus home spread from preferred books (excluding BetRivers). */
function pickConsensusSpread(
  books: Record<string, { spread?: number }>
): { spread: number; book: string } | undefined {
  for (const k of PREFERRED_BOOKS) {
    const lines = books?.[k];
    if (lines?.spread !== undefined) {
      return { spread: lines.spread, book: k };
    }
  }
  return undefined;
}

/** Load neutral site flags from today's opener JSON. */
function loadNeutralSiteByEventId(date: string, leagueId: string): Map<string, boolean> {
  const p = path.join(process.cwd(), "src", "data", leagueId, "odds_opening", `${date}.json`);
  try {
    const snap = JSON.parse(fs.readFileSync(p, "utf-8"));
    const m = new Map<string, boolean>();
    for (const g of snap.games ?? []) {
      if (g.oddsEventId) m.set(g.oddsEventId, g.neutralSite ?? false);
    }
    return m;
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const league = getLeague(LEAGUE);
  const today = todayET();
  const now = new Date();

  console.log(`[INTRADAY] Scanning ${LEAGUE} for ${today} at ${now.toISOString()}`);

  // Fetch current odds
  const provider = new TheOddsApiProvider(league.sportKey, league.id);
  let slate;
  try {
    slate = await provider.getSlate(today, true /* forceRefresh */);
  } catch (e: any) {
    console.error(`[INTRADAY] TheOddsAPI failed:`, e?.message ?? e);
    process.exit(1);
  }

  if (!slate.games.length) {
    console.log(`[INTRADAY] No games found for ${today}.`);
    process.exit(0);
  }

  // Load team ratings
  const teams = loadTeams(league.id);
  const neutralByEvent = loadNeutralSiteByEventId(today, league.id);

  // DB setup (dynamic import to allow graceful exit when POSTGRES_URL is missing)
  const { drizzle } = await import("drizzle-orm/vercel-postgres");
  const { sql: pgSql } = await import("@vercel/postgres");
  const { eq, and, inArray } = await import("drizzle-orm");
  const { schemaByLeague } = await import("@/db/schema");

  const db = drizzle(pgSql);
  const tables = schemaByLeague[LEAGUE];
  if (!tables) {
    console.error(`[INTRADAY] Unknown league schema: ${LEAGUE}`);
    process.exit(1);
  }

  let newPicks = 0;
  let scanned = 0;
  let skippedStarted = 0;
  let alreadyHadPick = 0;
  let noGameInDb = 0;
  let noSpread = 0;

  for (const game of slate.games) {
    // Skip games that have already started
    if (new Date(game.startTimeISO) <= now) {
      skippedStarted++;
      continue;
    }
    scanned++;

    // Get team data
    const home = teams.get(game.homeTeamId);
    const away = teams.get(game.awayTeamId);
    if (!home || !away) continue;

    // Neutral site
    const neutralSite = neutralByEvent.get(game.gameId) ?? false;
    const hca = neutralSite ? 0 : (home.hca ?? 2);

    // Compute model
    const eff = computeEfficiencyModel(home, away, hca);
    const rawModelSpread =
      eff?.modelSpread ?? computeModelSpread(home.powerRating, away.powerRating, hca);

    // Get consensus spread (excluding BetRivers)
    const consensus = pickConsensusSpread(game.books ?? {});
    if (!consensus) {
      noSpread++;
      continue;
    }

    const edgeRaw = computeEdge(rawModelSpread, consensus.spread);
    const edge = edgeRaw === undefined ? undefined : clamp(edgeRaw, -12, 12);
    const signal = computeSignal(edge);

    if (signal === "NONE") continue;

    // Look up game in DB by oddsEventId
    const gameRows = await db
      .select({ id: tables.games.id })
      .from(tables.games)
      .where(eq(tables.games.oddsEventId, game.gameId))
      .limit(1);

    if (gameRows.length === 0) {
      noGameInDb++;
      continue;
    }
    const gameId = gameRows[0].id;

    // Check if any existing prediction already has LEAN/STRONG
    const existingPicks = await db
      .select({ id: tables.modelPredictions.id })
      .from(tables.modelPredictions)
      .where(
        and(
          eq(tables.modelPredictions.gameId, gameId),
          inArray(tables.modelPredictions.signal, ["LEAN", "STRONG"]),
        )
      )
      .limit(1);

    if (existingPicks.length > 0) {
      alreadyHadPick++;
      continue;
    }

    // Insert new intraday prediction
    const pickSide = edge! < 0 ? "HOME" : "AWAY";
    await db.insert(tables.modelPredictions).values({
      gameId,
      capturedAt: now,
      openingBook: consensus.book,
      openingHomePoint: consensus.spread,
      openingAwayPoint: -consensus.spread,
      homeAdjO: home.adjO ?? null,
      homeAdjD: home.adjD ?? null,
      homeTempo: home.tempo ?? null,
      homeBarthag: home.barthag ?? null,
      homePowerRating: home.powerRating ?? null,
      homeHca: hca,
      awayAdjO: away.adjO ?? null,
      awayAdjD: away.adjD ?? null,
      awayTempo: away.tempo ?? null,
      awayBarthag: away.barthag ?? null,
      awayPowerRating: away.powerRating ?? null,
      rawModelSpread,
      modelSpread: rawModelSpread,
      edge: edge!,
      signal,
      pickSide,
    });

    newPicks++;
    console.log(
      `  NEW PICK: ${signal} ${pickSide} | ${game.awayTeam} @ ${game.homeTeam} ` +
        `| line: ${consensus.spread} (${consensus.book}) | edge: ${edge}`
    );
  }

  console.log(
    `[INTRADAY] Done: ${newPicks} new picks, ${alreadyHadPick} existing, ` +
      `${scanned} scanned, ${skippedStarted} started, ${noGameInDb} not in DB, ${noSpread} no spread`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[INTRADAY] Fatal error:", err);
  process.exit(1);
});
