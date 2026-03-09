CREATE TABLE "ncaam_closing_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"book" text,
	"home_point" real,
	"away_point" real
);
--> statement-breakpoint
CREATE TABLE "ncaam_game_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"actual_spread" real,
	"winner" text,
	"completed" boolean DEFAULT false,
	"fetched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ncaam_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"odds_event_id" text NOT NULL,
	"espn_event_id" text,
	"game_date" date NOT NULL,
	"commence_time" timestamp with time zone,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_torvik_id" text,
	"away_torvik_id" text,
	"home_espn_team_id" text,
	"away_espn_team_id" text,
	"home_conference" text,
	"away_conference" text,
	"neutral_site" boolean DEFAULT false,
	"backfilled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ncaam_games_odds_event_id_unique" UNIQUE("odds_event_id")
);
--> statement-breakpoint
CREATE TABLE "ncaam_model_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"opening_book" text,
	"opening_home_point" real,
	"opening_away_point" real,
	"home_adj_o" real,
	"home_adj_d" real,
	"home_tempo" real,
	"home_barthag" real,
	"home_power_rating" real,
	"home_hca" real,
	"away_adj_o" real,
	"away_adj_d" real,
	"away_tempo" real,
	"away_barthag" real,
	"away_power_rating" real,
	"raw_model_spread" real,
	"model_spread" real,
	"edge" real,
	"signal" text,
	"pick_side" text
);
--> statement-breakpoint
CREATE TABLE "ncaam_pick_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"prediction_id" integer NOT NULL,
	"pick_result" text,
	"clv" real,
	"evaluated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ncaam_team_rating_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"team_name" text NOT NULL,
	"conference" text,
	"wins" integer,
	"losses" integer,
	"power_rating" real,
	"hca" real,
	"adj_o" real,
	"adj_d" real,
	"tempo" real,
	"barthag" real,
	"torvik_rank" integer,
	"fetched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ncaaw_closing_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"book" text,
	"home_point" real,
	"away_point" real
);
--> statement-breakpoint
CREATE TABLE "ncaaw_game_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"actual_spread" real,
	"winner" text,
	"completed" boolean DEFAULT false,
	"fetched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ncaaw_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"odds_event_id" text NOT NULL,
	"espn_event_id" text,
	"game_date" date NOT NULL,
	"commence_time" timestamp with time zone,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_torvik_id" text,
	"away_torvik_id" text,
	"home_espn_team_id" text,
	"away_espn_team_id" text,
	"home_conference" text,
	"away_conference" text,
	"neutral_site" boolean DEFAULT false,
	"backfilled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ncaaw_games_odds_event_id_unique" UNIQUE("odds_event_id")
);
--> statement-breakpoint
CREATE TABLE "ncaaw_model_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"opening_book" text,
	"opening_home_point" real,
	"opening_away_point" real,
	"home_adj_o" real,
	"home_adj_d" real,
	"home_tempo" real,
	"home_barthag" real,
	"home_power_rating" real,
	"home_hca" real,
	"away_adj_o" real,
	"away_adj_d" real,
	"away_tempo" real,
	"away_barthag" real,
	"away_power_rating" real,
	"raw_model_spread" real,
	"model_spread" real,
	"edge" real,
	"signal" text,
	"pick_side" text
);
--> statement-breakpoint
CREATE TABLE "ncaaw_pick_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"prediction_id" integer NOT NULL,
	"pick_result" text,
	"clv" real,
	"evaluated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ncaaw_team_rating_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"team_name" text NOT NULL,
	"conference" text,
	"wins" integer,
	"losses" integer,
	"power_rating" real,
	"hca" real,
	"adj_o" real,
	"adj_d" real,
	"tempo" real,
	"barthag" real,
	"torvik_rank" integer,
	"fetched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ncaam_team_snapshot_uniq" ON "ncaam_team_rating_snapshots" USING btree ("team_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ncaaw_team_snapshot_uniq" ON "ncaaw_team_rating_snapshots" USING btree ("team_id","snapshot_date");