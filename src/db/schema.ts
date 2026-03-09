// src/db/schema.ts
// Drizzle ORM schema for the NCAA hoops model.
//
// Design principle: SEPARATE tables per league (ncaam_* / ncaaw_*).
// This keeps queries fast, avoids cross-league contamination, and lets each
// league's table evolve independently if the data shapes diverge.
//
// A "table factory" function creates identical column shapes under different
// table names.  The two league table sets are then exported as plain objects
// so the rest of the codebase can do:
//   import { ncaam, ncaaw } from "@/db/schema";
//   db.select().from(ncaam.games)…

import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Table factories — called once per league
// ---------------------------------------------------------------------------

/**
 * games — one row per game (known at opener snapshot time)
 */
function makeGames(prefix: string) {
  return pgTable(`${prefix}_games`, {
    id:                serial("id").primaryKey(),

    // Identifiers
    oddsEventId:       text("odds_event_id").unique().notNull(),
    espnEventId:       text("espn_event_id"),

    // Schedule
    gameDate:          date("game_date").notNull(),          // ET date (YYYY-MM-DD)
    commenceTime:      timestamp("commence_time", { withTimezone: true }),

    // Teams
    homeTeam:          text("home_team").notNull(),
    awayTeam:          text("away_team").notNull(),
    homeTorvikId:      text("home_torvik_id"),
    awayTorvikId:      text("away_torvik_id"),
    homeEspnTeamId:    text("home_espn_team_id"),
    awayEspnTeamId:    text("away_espn_team_id"),
    homeConference:    text("home_conference"),
    awayConference:    text("away_conference"),

    neutralSite:       boolean("neutral_site").default(false),
    backfilled:        boolean("backfilled").default(false),
    createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow(),
  });
}

/**
 * model_predictions — opener snapshot + model outputs.
 * Team ratings captured at prediction time prevent data leakage in ML.
 */
function makeModelPredictions(prefix: string) {
  return pgTable(`${prefix}_model_predictions`, {
    id:                serial("id").primaryKey(),
    gameId:            integer("game_id").notNull(),        // FK → {prefix}_games.id

    capturedAt:        timestamp("captured_at", { withTimezone: true }).notNull(),
    openingBook:       text("opening_book"),
    openingHomePoint:  real("opening_home_point"),
    openingAwayPoint:  real("opening_away_point"),

    // Home team ratings at time of prediction
    homeAdjO:          real("home_adj_o"),
    homeAdjD:          real("home_adj_d"),
    homeTempo:         real("home_tempo"),
    homeBarthag:       real("home_barthag"),
    homePowerRating:   real("home_power_rating"),
    homeHca:           real("home_hca"),

    // Away team ratings at time of prediction
    awayAdjO:          real("away_adj_o"),
    awayAdjD:          real("away_adj_d"),
    awayTempo:         real("away_tempo"),
    awayBarthag:       real("away_barthag"),
    awayPowerRating:   real("away_power_rating"),

    // Model outputs
    rawModelSpread:    real("raw_model_spread"),
    modelSpread:       real("model_spread"),
    edge:              real("edge"),
    signal:            text("signal"),                      // "NONE" | "LEAN" | "STRONG"
    pickSide:          text("pick_side"),                   // "HOME" | "AWAY" | null
  });
}

/**
 * closing_lines — last available line before tip-off
 */
function makeClosingLines(prefix: string) {
  return pgTable(`${prefix}_closing_lines`, {
    id:                serial("id").primaryKey(),
    gameId:            integer("game_id").notNull(),        // FK → {prefix}_games.id
    snapshotTime:      timestamp("snapshot_time", { withTimezone: true }).notNull(),
    book:              text("book"),
    homePoint:         real("home_point"),
    awayPoint:         real("away_point"),
  });
}

/**
 * game_results — final scores from ESPN
 */
function makeGameResults(prefix: string) {
  return pgTable(`${prefix}_game_results`, {
    id:                serial("id").primaryKey(),
    gameId:            integer("game_id").notNull(),        // FK → {prefix}_games.id
    homeScore:         integer("home_score"),
    awayScore:         integer("away_score"),
    actualSpread:      real("actual_spread"),               // home − away score
    winner:            text("winner"),                      // "HOME" | "AWAY" | "TIE"
    completed:         boolean("completed").default(false),
    fetchedAt:         timestamp("fetched_at", { withTimezone: true }).defaultNow(),
  });
}

/**
 * pick_evaluations — derived outcome for each modeled pick
 */
function makePickEvaluations(prefix: string) {
  return pgTable(`${prefix}_pick_evaluations`, {
    id:                serial("id").primaryKey(),
    gameId:            integer("game_id").notNull(),        // FK → {prefix}_games.id
    predictionId:      integer("prediction_id").notNull(),  // FK → {prefix}_model_predictions.id
    pickResult:        text("pick_result"),                 // "WIN" | "LOSS" | "PUSH" | "PENDING"
    clv:               real("clv"),                         // closing-line value (pts)
    evaluatedAt:       timestamp("evaluated_at", { withTimezone: true }).defaultNow(),
  });
}

/**
 * team_rating_snapshots — daily Torvik ratings for each team.
 * Indexed by (team_id, date) to build time-series for ML.
 */
function makeTeamRatingSnapshots(prefix: string) {
  return pgTable(
    `${prefix}_team_rating_snapshots`,
    {
      id:              serial("id").primaryKey(),
      teamId:          text("team_id").notNull(),           // Torvik ID / slug
      snapshotDate:    date("snapshot_date").notNull(),     // date Torvik data was fetched

      // Identifiers
      teamName:        text("team_name").notNull(),
      conference:      text("conference"),

      // Record
      wins:            integer("wins"),
      losses:          integer("losses"),

      // Torvik ratings
      powerRating:     real("power_rating"),
      hca:             real("hca"),
      adjO:            real("adj_o"),
      adjD:            real("adj_d"),
      tempo:           real("tempo"),
      barthag:         real("barthag"),
      torvikRank:      integer("torvik_rank"),

      fetchedAt:       timestamp("fetched_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
      uniqTeamDate: uniqueIndex(`${prefix}_team_snapshot_uniq`).on(t.teamId, t.snapshotDate),
    })
  );
}

// ---------------------------------------------------------------------------
// League table sets
// ---------------------------------------------------------------------------

/** All tables for Men's college basketball (NCAAM) */
export const ncaam = {
  games:               makeGames("ncaam"),
  modelPredictions:    makeModelPredictions("ncaam"),
  closingLines:        makeClosingLines("ncaam"),
  gameResults:         makeGameResults("ncaam"),
  pickEvaluations:     makePickEvaluations("ncaam"),
  teamRatingSnapshots: makeTeamRatingSnapshots("ncaam"),
} as const;

/** All tables for Women's college basketball (NCAAW) */
export const ncaaw = {
  games:               makeGames("ncaaw"),
  modelPredictions:    makeModelPredictions("ncaaw"),
  closingLines:        makeClosingLines("ncaaw"),
  gameResults:         makeGameResults("ncaaw"),
  pickEvaluations:     makePickEvaluations("ncaaw"),
  teamRatingSnapshots: makeTeamRatingSnapshots("ncaaw"),
} as const;

/** Lookup by LeagueId string */
export const schemaByLeague: Record<string, typeof ncaam | typeof ncaaw> = {
  ncaam,
  ncaaw,
};

// ---------------------------------------------------------------------------
// Type helpers (inferred from schema)
// ---------------------------------------------------------------------------

export type NcaamGame               = typeof ncaam.games.$inferSelect;
export type NewNcaamGame            = typeof ncaam.games.$inferInsert;
export type NcaamModelPrediction    = typeof ncaam.modelPredictions.$inferSelect;
export type NewNcaamModelPrediction = typeof ncaam.modelPredictions.$inferInsert;
export type NcaamGameResult         = typeof ncaam.gameResults.$inferSelect;
export type NewNcaamGameResult      = typeof ncaam.gameResults.$inferInsert;
export type NcaamClosingLine        = typeof ncaam.closingLines.$inferSelect;
export type NewNcaamClosingLine     = typeof ncaam.closingLines.$inferInsert;
export type NcaamPickEvaluation     = typeof ncaam.pickEvaluations.$inferSelect;
export type NewNcaamPickEvaluation  = typeof ncaam.pickEvaluations.$inferInsert;
export type NcaamTeamRatingSnapshot = typeof ncaam.teamRatingSnapshots.$inferSelect;
export type NewNcaamTeamRatingSnapshot = typeof ncaam.teamRatingSnapshots.$inferInsert;

// NCAAW types are structurally identical — use the same type aliases
export type NcaawGame               = typeof ncaaw.games.$inferSelect;
export type NcaawModelPrediction    = typeof ncaaw.modelPredictions.$inferSelect;
export type NcaawGameResult         = typeof ncaaw.gameResults.$inferSelect;
export type NcaawClosingLine        = typeof ncaaw.closingLines.$inferSelect;
export type NcaawPickEvaluation     = typeof ncaaw.pickEvaluations.$inferSelect;
export type NcaawTeamRatingSnapshot = typeof ncaaw.teamRatingSnapshots.$inferSelect;
