// src/db/dailySync.ts
// Helper functions for dual-write: each daily script calls one of these after
// successfully writing the JSON file. DB writes are best-effort — if POSTGRES_URL
// is not set or a write fails, the script continues without error.
//
// All functions are idempotent: re-running a script for the same date is safe.

import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql as pgSql } from "@vercel/postgres";
import { eq, and, inArray } from "drizzle-orm";
import { schemaByLeague } from "./schema";

function getDb() {
  return drizzle(pgSql);
}

// ---- Sync opener snapshot → games + model_predictions ---------------------

export type OpenerGameForDb = {
  oddsEventId: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  home_espnTeamId?: string | null;
  away_espnTeamId?: string | null;
  neutralSite?: boolean;
  homeConference?: string | null;
  awayConference?: string | null;
  opening: { book?: string; homePoint: number; awayPoint: number } | null;
  model: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    modelSpread: number | null;
    rawModelSpread?: number | null;
    edge: number | null;
    signal: string;
    homeAdjO?: number | null;
    homeAdjD?: number | null;
    homeTempo?: number | null;
    homeBarthag?: number | null;
    homePowerRating?: number | null;
    homeHca?: number | null;
    awayAdjO?: number | null;
    awayAdjD?: number | null;
    awayTempo?: number | null;
    awayBarthag?: number | null;
    awayPowerRating?: number | null;
  } | null;
};

export async function syncOpenerToDb(
  leagueId: string,
  date: string,
  capturedAt: string,
  games: OpenerGameForDb[]
): Promise<void> {
  const tables = schemaByLeague[leagueId];
  if (!tables) throw new Error(`Unknown league: ${leagueId}`);
  const db = getDb();

  const LIVE_FROM = "2026-03-02";
  const isBackfilled = date < LIVE_FROM;

  for (const sg of games) {
    // Upsert game row (skip on duplicate oddsEventId)
    const existing = await db
      .select({ id: tables.games.id })
      .from(tables.games)
      .where(eq(tables.games.oddsEventId, sg.oddsEventId))
      .limit(1);

    let gameId: number;

    const openingHomePoint = sg.opening?.homePoint ?? null;
    const openingBook      = sg.opening?.book ?? null;

    if (existing.length > 0) {
      gameId = existing[0].id;
      // Backfill opening line if not set yet
      if (openingHomePoint !== null) {
        await db
          .update(tables.games)
          .set({ openingHomePoint, openingBook })
          .where(eq(tables.games.id, gameId));
      }
    } else {
      const ins = await db
        .insert(tables.games)
        .values({
          oddsEventId:    sg.oddsEventId,
          gameDate:       date,
          commenceTime:   sg.commence_time ? new Date(sg.commence_time) : undefined,
          homeTeam:       sg.home_team,
          awayTeam:       sg.away_team,
          homeTorvikId:   sg.model?.homeTeamId ?? null,
          awayTorvikId:   sg.model?.awayTeamId ?? null,
          homeEspnTeamId: sg.home_espnTeamId ?? null,
          awayEspnTeamId: sg.away_espnTeamId ?? null,
          homeConference: sg.homeConference ?? null,
          awayConference: sg.awayConference ?? null,
          neutralSite:    sg.neutralSite ?? false,
          backfilled:     isBackfilled,
          openingHomePoint,
          openingBook,
        })
        .returning({ id: tables.games.id });
      gameId = ins[0].id;
    }

    // Insert model prediction if not already present
    if (sg.model || sg.opening) {
      const existPred = await db
        .select({ id: tables.modelPredictions.id })
        .from(tables.modelPredictions)
        .where(eq(tables.modelPredictions.gameId, gameId))
        .limit(1);

      if (existPred.length === 0) {
        const signal   = sg.model?.signal ?? "NONE";
        const edge     = sg.model?.edge ?? null;
        const pickSide = signal !== "NONE" && edge !== null
          ? edge < 0 ? "HOME" : "AWAY"
          : null;

        await db.insert(tables.modelPredictions).values({
          gameId,
          capturedAt:       new Date(capturedAt),
          openingBook:      sg.opening?.book ?? null,
          openingHomePoint: sg.opening?.homePoint ?? null,
          openingAwayPoint: sg.opening?.awayPoint ?? null,
          homeAdjO:         sg.model?.homeAdjO ?? null,
          homeAdjD:         sg.model?.homeAdjD ?? null,
          homeTempo:        sg.model?.homeTempo ?? null,
          homeBarthag:      sg.model?.homeBarthag ?? null,
          homePowerRating:  sg.model?.homePowerRating ?? null,
          homeHca:          sg.model?.homeHca ?? null,
          awayAdjO:         sg.model?.awayAdjO ?? null,
          awayAdjD:         sg.model?.awayAdjD ?? null,
          awayTempo:        sg.model?.awayTempo ?? null,
          awayBarthag:      sg.model?.awayBarthag ?? null,
          awayPowerRating:  sg.model?.awayPowerRating ?? null,
          rawModelSpread:   sg.model?.rawModelSpread ?? sg.model?.modelSpread ?? null,
          modelSpread:      sg.model?.modelSpread ?? null,
          edge,
          signal,
          pickSide,
        });
      }
    }
  }
}

// ---- Sync closing lines → closing_lines ------------------------------------

export type ClosingLineForDb = {
  oddsEventId: string;
  homePoint: number | null;
  awayPoint: number | null;
  book?: string | null;
  snapshotTime: string;
};

export async function syncClosingLinesToDb(
  leagueId: string,
  _date: string,
  games: ClosingLineForDb[]
): Promise<void> {
  const tables = schemaByLeague[leagueId];
  if (!tables) throw new Error(`Unknown league: ${leagueId}`);
  const db = getDb();

  for (const cl of games) {
    if (!cl.oddsEventId) continue;

    // Look up game_id from oddsEventId
    const gameRows = await db
      .select({ id: tables.games.id })
      .from(tables.games)
      .where(eq(tables.games.oddsEventId, cl.oddsEventId))
      .limit(1);
    if (gameRows.length === 0) continue; // game not in DB yet (opener not synced)

    const gameId = gameRows[0].id;

    // Upsert closing line: keep the latest snapshot for each game
    const existing = await db
      .select({ id: tables.closingLines.id, snapshotTime: tables.closingLines.snapshotTime })
      .from(tables.closingLines)
      .where(eq(tables.closingLines.gameId, gameId))
      .limit(1);

    const newSnapshotTime = new Date(cl.snapshotTime);

    if (existing.length === 0) {
      await db.insert(tables.closingLines).values({
        gameId,
        snapshotTime: newSnapshotTime,
        book:         cl.book ?? null,
        homePoint:    cl.homePoint ?? null,
        awayPoint:    cl.awayPoint ?? null,
      });
    } else if (existing[0].snapshotTime && newSnapshotTime > existing[0].snapshotTime) {
      // Update to later snapshot
      await db
        .update(tables.closingLines)
        .set({
          snapshotTime: newSnapshotTime,
          book:         cl.book ?? null,
          homePoint:    cl.homePoint ?? null,
          awayPoint:    cl.awayPoint ?? null,
        })
        .where(eq(tables.closingLines.id, existing[0].id));
    }
  }
}

// ---- Sync game results → game_results + pick_evaluations ------------------

export type ResultGameForDb = {
  espnEventId?: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  actualSpread: number | null;
  winner: "HOME" | "AWAY" | "TIE" | null;
  completed: boolean;
};

export async function syncResultsToDb(
  leagueId: string,
  _date: string,
  fetchedAt: string,
  results: ResultGameForDb[]
): Promise<void> {
  const tables = schemaByLeague[leagueId];
  if (!tables) throw new Error(`Unknown league: ${leagueId}`);
  const db = getDb();

  for (const r of results) {
    if (!r.home_espnTeamId || !r.away_espnTeamId) continue;

    // Match game by ESPN team IDs
    const gameRows = await db
      .select({ id: tables.games.id })
      .from(tables.games)
      .where(
        and(
          eq(tables.games.homeEspnTeamId, r.home_espnTeamId),
          eq(tables.games.awayEspnTeamId, r.away_espnTeamId)
        )
      )
      .limit(1);
    if (gameRows.length === 0) continue;

    const gameId = gameRows[0].id;

    // Insert or update result
    const existResult = await db
      .select({ id: tables.gameResults.id })
      .from(tables.gameResults)
      .where(eq(tables.gameResults.gameId, gameId))
      .limit(1);

    if (existResult.length === 0) {
      await db.insert(tables.gameResults).values({
        gameId,
        homeScore:    r.homeScore ?? null,
        awayScore:    r.awayScore ?? null,
        actualSpread: r.actualSpread ?? null,
        winner:       r.winner ?? null,
        completed:    r.completed,
        fetchedAt:    new Date(fetchedAt),
      });
    } else if (r.completed) {
      // Update to final score once completed
      await db
        .update(tables.gameResults)
        .set({
          homeScore:    r.homeScore ?? null,
          awayScore:    r.awayScore ?? null,
          actualSpread: r.actualSpread ?? null,
          winner:       r.winner ?? null,
          completed:    r.completed,
          fetchedAt:    new Date(fetchedAt),
        })
        .where(eq(tables.gameResults.id, existResult[0].id));
    }

    // Upsert pick evaluations — evaluate ALL LEAN/STRONG predictions per game
    if (r.completed) {
      const predRows = await db
        .select({
          id:               tables.modelPredictions.id,
          edge:             tables.modelPredictions.edge,
          signal:           tables.modelPredictions.signal,
          openingHomePoint: tables.modelPredictions.openingHomePoint,
        })
        .from(tables.modelPredictions)
        .where(
          and(
            eq(tables.modelPredictions.gameId, gameId),
            inArray(tables.modelPredictions.signal, ["LEAN", "STRONG"]),
          )
        );

      // Get closing line once for all predictions
      const closeRows = await db
        .select({ homePoint: tables.closingLines.homePoint })
        .from(tables.closingLines)
        .where(eq(tables.closingLines.gameId, gameId))
        .limit(1);
      const closePt = closeRows[0]?.homePoint ?? null;

      for (const pred of predRows) {
        const edge   = pred.edge ?? null;
        if (edge === null) continue;

        const openPt = pred.openingHomePoint ?? null;
        const actual = r.actualSpread ?? null;

        // Determine pick result
        let pickResult: string = "PENDING";
        if (actual !== null && openPt !== null) {
          const pickSide = edge < 0 ? "HOME" : "AWAY";
          const margin = actual - openPt;
          if (Math.abs(margin) < 0.01) {
            pickResult = "PUSH";
          } else {
            const homeCovered = margin < 0;
            pickResult = pickSide === "HOME"
              ? (homeCovered ? "WIN" : "LOSS")
              : (homeCovered ? "LOSS" : "WIN");
          }
        }

        // Compute CLV
        let clv: number | null = null;
        if (openPt !== null && closePt !== null) {
          const pickSide = edge < 0 ? "HOME" : "AWAY";
          const raw = openPt - closePt;
          clv = pickSide === "HOME" ? raw : -raw;
        }

        // Upsert by predictionId (not gameId)
        const existEval = await db
          .select({ id: tables.pickEvaluations.id })
          .from(tables.pickEvaluations)
          .where(eq(tables.pickEvaluations.predictionId, pred.id))
          .limit(1);

        if (existEval.length === 0) {
          await db.insert(tables.pickEvaluations).values({
            gameId,
            predictionId:  pred.id,
            pickResult,
            clv,
          });
        } else {
          await db
            .update(tables.pickEvaluations)
            .set({ pickResult, clv })
            .where(eq(tables.pickEvaluations.id, existEval[0].id));
        }
      }
    }
  }
}

// ---- Sync team rating snapshot → team_rating_snapshots --------------------

export type TeamRatingForDb = {
  teamId: string;
  teamName: string;
  conference?: string | null;
  wins?: number | null;
  losses?: number | null;
  powerRating?: number | null;
  hca?: number | null;
  adjO?: number | null;
  adjD?: number | null;
  tempo?: number | null;
  barthag?: number | null;
  torvikRank?: number | null;
};

export async function syncTeamRatingsToDb(
  leagueId: string,
  date: string,
  teams: TeamRatingForDb[]
): Promise<void> {
  const tables = schemaByLeague[leagueId];
  if (!tables) throw new Error(`Unknown league: ${leagueId}`);
  const db = getDb();

  for (const t of teams) {
    if (!t.teamId) continue;

    // Check for existing snapshot (unique: teamId + date)
    const existing = await db
      .select({ id: tables.teamRatingSnapshots.id })
      .from(tables.teamRatingSnapshots)
      .where(
        and(
          eq(tables.teamRatingSnapshots.teamId, t.teamId),
          eq(tables.teamRatingSnapshots.snapshotDate, date)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update with latest ratings
      await db
        .update(tables.teamRatingSnapshots)
        .set({
          teamName:    t.teamName,
          conference:  t.conference ?? null,
          wins:        t.wins ?? null,
          losses:      t.losses ?? null,
          powerRating: t.powerRating ?? null,
          hca:         t.hca ?? null,
          adjO:        t.adjO ?? null,
          adjD:        t.adjD ?? null,
          tempo:       t.tempo ?? null,
          barthag:     t.barthag ?? null,
          torvikRank:  t.torvikRank ?? null,
          fetchedAt:   new Date(),
        })
        .where(eq(tables.teamRatingSnapshots.id, existing[0].id));
    } else {
      await db.insert(tables.teamRatingSnapshots).values({
        teamId:      t.teamId,
        snapshotDate: date,
        teamName:    t.teamName,
        conference:  t.conference ?? null,
        wins:        t.wins ?? null,
        losses:      t.losses ?? null,
        powerRating: t.powerRating ?? null,
        hca:         t.hca ?? null,
        adjO:        t.adjO ?? null,
        adjD:        t.adjD ?? null,
        tempo:       t.tempo ?? null,
        barthag:     t.barthag ?? null,
        torvikRank:  t.torvikRank ?? null,
      });
    }
  }
}
