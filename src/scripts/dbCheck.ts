// src/scripts/dbCheck.ts — temporary diagnostic script
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql as pgSql } from "@vercel/postgres";
import { sql } from "drizzle-orm";

const db = drizzle(pgSql);

const tables = [
  "ncaam_games", "ncaam_model_predictions", "ncaam_closing_lines",
  "ncaam_game_results", "ncaam_pick_evaluations", "ncaam_team_rating_snapshots",
  "ncaaw_games", "ncaaw_model_predictions", "ncaaw_closing_lines",
  "ncaaw_game_results", "ncaaw_pick_evaluations", "ncaaw_team_rating_snapshots",
];

async function main() {
  // Row counts
  console.log("=== Row counts ===");
  for (const t of tables) {
    const res = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ${t}`));
    console.log(`  ${t.padEnd(35)}: ${(res.rows[0] as any).cnt}`);
  }

  // Sample games
  console.log("\n=== Sample ncaam_games (3 rows) ===");
  const games = await db.execute(sql.raw(
    `SELECT id, game_date, home_team, away_team, neutral_site, backfilled, home_conference, away_conference
     FROM ncaam_games ORDER BY game_date DESC LIMIT 3`
  ));
  games.rows.forEach(r => console.log(" ", r));

  // Sample predictions — check ratings captured
  console.log("\n=== Sample ncaam_model_predictions (ratings check) ===");
  const preds = await db.execute(sql.raw(
    `SELECT p.id, p.game_id, p.signal, p.edge, p.model_spread, p.opening_home_point,
            p.home_adj_o, p.home_adj_d, p.away_adj_o, p.away_adj_d
     FROM ncaam_model_predictions p
     WHERE p.signal != 'NONE'
     LIMIT 3`
  ));
  preds.rows.forEach(r => console.log(" ", r));

  // Pick W/L record
  console.log("\n=== NCAAM pick W-L record ===");
  const ncaamRecord = await db.execute(sql.raw(
    `SELECT pick_result, COUNT(*) as cnt FROM ncaam_pick_evaluations GROUP BY pick_result ORDER BY pick_result`
  ));
  ncaamRecord.rows.forEach(r => console.log(" ", r));

  console.log("\n=== NCAAW pick W-L record ===");
  const ncaawRecord = await db.execute(sql.raw(
    `SELECT pick_result, COUNT(*) as cnt FROM ncaaw_pick_evaluations GROUP BY pick_result ORDER BY pick_result`
  ));
  ncaawRecord.rows.forEach(r => console.log(" ", r));

  // Sample closing lines
  console.log("\n=== Sample ncaam_closing_lines (3 rows) ===");
  const closing = await db.execute(sql.raw(
    `SELECT cl.id, cl.game_id, cl.home_point, cl.away_point, cl.book, g.home_team, g.away_team
     FROM ncaam_closing_lines cl JOIN ncaam_games g ON g.id = cl.game_id LIMIT 3`
  ));
  closing.rows.forEach(r => console.log(" ", r));

  // CLV distribution
  console.log("\n=== NCAAM CLV distribution (picks with CLV) ===");
  const clv = await db.execute(sql.raw(
    `SELECT ROUND(AVG(clv)::numeric, 2) as avg_clv,
            MIN(clv) as min_clv, MAX(clv) as max_clv,
            COUNT(*) as total_with_clv
     FROM ncaam_pick_evaluations WHERE clv IS NOT NULL`
  ));
  clv.rows.forEach(r => console.log(" ", r));

  // Check team rating snapshots specifically
  console.log("\n=== Team rating snapshots — any rows at all? ===");
  const snapshots = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM ncaam_team_rating_snapshots`
  ));
  console.log("  ncaam_team_rating_snapshots:", (snapshots.rows[0] as any).cnt);

  // Cross-check: does the seed script call syncTeamRatingsToDb?
  // The seed script (migrateJsonToDb.ts) doesn't call it — that's from updateTeamsFromTorvik.ts
  console.log("\n  NOTE: team_rating_snapshots are populated by updateTeamsFromTorvik.ts,");
  console.log("  NOT by the JSON seed. Run that script once to backfill today's ratings.");
}

main().catch(console.error);
