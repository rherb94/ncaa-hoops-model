// src/lib/analysis.ts
// Core of the model-performance analysis: joins a day's opener snapshot with
// results and closing lines and grades every pick. Shared by the analysis API
// route and the nightly season-record script so they can never disagree.

import fs from "node:fs";
import path from "node:path";
import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";
import { getGameOverrides } from "@/lib/overrides";
import { isPlay } from "@/lib/signal";
import { pickPrice, unitsFor, round2 } from "@/lib/grading";

export const DATA_DIR = path.join(process.cwd(), "src", "data");

// ---------------------------------------------------------------------------
// Live results fetching (ESPN public API) — used when no results file exists
// and the date is today or yesterday (games may still be in progress).
// ---------------------------------------------------------------------------

export type EspnCompetitor = {
  id: string;
  homeAway: "home" | "away";
  score?: string;
  team: { id: string; displayName: string };
};

export type EspnEvent = {
  id: string;
  date: string;
  status: { type: { completed: boolean; description: string } };
  competitions: Array<{ competitors: EspnCompetitor[] }>;
};

export async function fetchLiveResults(date: string, leagueId: string): Promise<ResultGame[]> {
  const league = LEAGUES[leagueId as LeagueId];
  if (!league) return [];

  const espnDateStr = date.replace(/-/g, "");
  const nextDayDate = new Date(`${date}T12:00:00Z`);
  nextDayDate.setUTCDate(nextDayDate.getUTCDate() + 1);
  const espnDateNextStr = nextDayDate.toISOString().slice(0, 10).replace(/-/g, "");

  const dayStartUtc = new Date(`${date}T05:00:00Z`);
  const dayEndUtc   = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  const espnUrl = (d: string) =>
    `https://site.api.espn.com/apis/site/v2/sports/${league.espnSportFamily}` +
    `/${league.espnSport}/scoreboard?dates=${d}&groups=${league.espnGroupId}&limit=200`;

  async function fetchEvents(d: string): Promise<EspnEvent[]> {
    try {
      const res = await fetch(espnUrl(d), {
        headers: { "user-agent": "ncaam-model/1.0 (personal project)" },
        next: { revalidate: 60 }, // cache for 60 seconds
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { events?: EspnEvent[] };
      return json.events ?? [];
    } catch {
      return [];
    }
  }

  const [eventsToday, eventsNextUtc] = await Promise.all([
    fetchEvents(espnDateStr),
    fetchEvents(espnDateNextStr),
  ]);

  // Deduplicate — prefer record from "today"
  const eventMap = new Map<string, EspnEvent>();
  for (const e of [...eventsNextUtc, ...eventsToday]) eventMap.set(e.id, e);

  // Filter to ET date window
  const events = [...eventMap.values()].filter((e) => {
    const ct = new Date(e.date);
    return ct >= dayStartUtc && ct < dayEndUtc;
  });

  return events.map((e) => {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");

    const homeScore = home?.score != null ? Number(home.score) : null;
    const awayScore = away?.score != null ? Number(away.score) : null;
    const completed = e.status?.type?.completed ?? false;

    const actualSpread =
      completed && homeScore != null && awayScore != null
        ? -(homeScore - awayScore)
        : null;

    const winner: "HOME" | "AWAY" | "TIE" | null =
      completed && homeScore != null && awayScore != null
        ? homeScore > awayScore ? "HOME" : awayScore > homeScore ? "AWAY" : "TIE"
        : null;

    return {
      espnEventId: e.id,
      home_espnTeamId: home?.team.id ?? null,
      away_espnTeamId: away?.team.id ?? null,
      completed,
      homeScore,
      awayScore,
      actualSpread,
      winner,
    };
  });
}

export function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(new Date())
    .slice(0, 10);
}

export function yesterdayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(new Date(Date.now() - 24 * 60 * 60 * 1000))
    .slice(0, 10);
}

export function loadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function datesInRange(from: string, to: string, limit = 200): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  while (cur <= end && dates.length < limit) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export function allAvailableDates(leagueId: string): string[] {
  const snapDir = path.join(DATA_DIR, leagueId, "odds_opening");
  if (!fs.existsSync(snapDir)) return [];
  return fs
    .readdirSync(snapDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

export type SnapshotGame = {
  oddsEventId: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  neutralSite?: boolean;
  opening: {
    book: string;
    homePoint: number;
    awayPoint: number;
    /** American odds on each side of the spread; absent on older snapshots. */
    homePrice?: number | null;
    awayPrice?: number | null;
  } | null;
  model: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    rawModelSpread: number | null;
    modelSpread: number | null;
    edge: number | null;
    signal: string;
  } | null;
};

export type ResultGame = {
  espnEventId: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  actualSpread: number | null; // home spread convention
  winner: "HOME" | "AWAY" | "TIE" | null;
};

export type ClosingLineGame = {
  oddsEventId: string;
  homePoint: number | null;
  awayPoint: number | null;
};

export function evaluatePick(
  signal: string,
  edge: number | null,
  openingHomePoint: number | null,
  actualSpread: number | null // home spread: neg = home won by abs(n)
): "WIN" | "LOSS" | "PUSH" | "NO_PICK" | "PENDING" {
  if (!isPlay(signal) || edge === null) return "NO_PICK"; // CAUTION is not a play
  if (actualSpread === null) return "PENDING";
  if (openingHomePoint === null) return "PENDING";

  // edge > 0 → model likes AWAY (model spread > market spread → home is overpriced)
  // edge < 0 → model likes HOME
  const pickSide: "HOME" | "AWAY" = edge < 0 ? "HOME" : "AWAY";
  const line = openingHomePoint; // home spread line we "bet against" or "with"

  // Did the home team cover?
  // actualSpread = -(homeScore - awayScore) in home-spread convention
  // e.g. home wins by 7: actualSpread = -7
  const margin = actualSpread - line; // positive = home covered, negative = away covered

  if (Math.abs(margin) < 0.01) return "PUSH";
  const homeCovered = margin < 0; // actualSpread < line means home did better than line

  if (pickSide === "HOME") return homeCovered ? "WIN" : "LOSS";
  return homeCovered ? "LOSS" : "WIN"; // picking AWAY
}

export function computeClv(
  openingHomePoint: number | null,
  closingHomePoint: number | null,
  pickSide: "HOME" | "AWAY" | "NONE"
): number | null {
  if (openingHomePoint === null || closingHomePoint === null) return null;
  if (pickSide === "NONE") return null;
  // CLV = points gained vs. closing line from our pick's perspective.
  // HOME pick: positive CLV = opening was better (less negative) than close.
  //   e.g. open -3, close -5 → we avoided -5 → CLV = open - close = -3 - (-5) = +2
  // AWAY pick: positive CLV = closing moved in AWAY direction vs opening.
  //   e.g. open -3, close -1 → away went from +3 to +1 → we got better AWAY price → CLV = close - open = -1 - (-3) = +2
  const raw = openingHomePoint - closingHomePoint;
  return pickSide === "HOME" ? raw : -raw;
}

// ---------------------------------------------------------------------------
// Intraday picks from DB — games that became picks after the opener snapshot
// ---------------------------------------------------------------------------

export type IntradayPick = {
  oddsEventId: string;
  capturedAt: string;         // ISO timestamp
  openingHomePoint: number;
  openingBook: string | null;
  modelSpread: number;
  edge: number;
  signal: string;
  pickSide: string;
};

export async function fetchIntradayPicks(
  dates: string[],
  leagueId: string
): Promise<Map<string, IntradayPick[]>> {
  const map = new Map<string, IntradayPick[]>();
  if (!process.env.POSTGRES_URL) return map;

  try {
    const { drizzle } = await import("drizzle-orm/vercel-postgres");
    const { sql: pgSql } = await import("@vercel/postgres");
    const { eq, and, inArray } = await import("drizzle-orm");
    const { schemaByLeague } = await import("@/db/schema");

    const tables = schemaByLeague[leagueId];
    if (!tables) return map;
    const db = drizzle(pgSql);

    // Query all LEAN/STRONG predictions for games on the requested dates
    for (const date of dates) {
      const rows = await db
        .select({
          oddsEventId:    tables.games.oddsEventId,
          capturedAt:     tables.modelPredictions.capturedAt,
          openingHomePoint: tables.modelPredictions.openingHomePoint,
          openingBook:    tables.modelPredictions.openingBook,
          modelSpread:    tables.modelPredictions.modelSpread,
          edge:           tables.modelPredictions.edge,
          signal:         tables.modelPredictions.signal,
          pickSide:       tables.modelPredictions.pickSide,
        })
        .from(tables.modelPredictions)
        .innerJoin(tables.games, eq(tables.games.id, tables.modelPredictions.gameId))
        .where(
          and(
            eq(tables.games.gameDate, date),
            inArray(tables.modelPredictions.signal, ["LEAN", "STRONG"]),
          )
        )
        .orderBy(tables.modelPredictions.capturedAt);

      if (rows.length > 0) {
        // Keep only the FIRST LEAN/STRONG prediction per game (earliest capturedAt)
        const byEvent = new Map<string, IntradayPick>();
        for (const r of rows) {
          if (!byEvent.has(r.oddsEventId) && r.edge != null && r.signal != null) {
            byEvent.set(r.oddsEventId, {
              oddsEventId: r.oddsEventId,
              capturedAt: (r.capturedAt as Date).toISOString(),
              openingHomePoint: r.openingHomePoint!,
              openingBook: r.openingBook,
              modelSpread: r.modelSpread!,
              edge: r.edge,
              signal: r.signal,
              pickSide: r.pickSide ?? (r.edge < 0 ? "HOME" : "AWAY"),
            });
          }
        }
        map.set(date, [...byEvent.values()]);
      }
    }
  } catch (err) {
    console.warn("[ANALYSIS] Intraday picks query failed, using JSON-only:", err);
  }

  return map;
}

// First date with a real automated live snapshot (anything before this was backfilled
// retroactively using the TheOddsAPI historical endpoint).
export const LIVE_FROM = "2026-03-02";

export function analyzeDate(
  date: string,
  leagueId: string,
  liveResults?: ResultGame[],
  intradayPicks?: IntradayPick[],
) {
  const snapDir  = path.join(DATA_DIR, leagueId, "odds_opening");
  const resDir   = path.join(DATA_DIR, leagueId, "results");
  const closeDir = path.join(DATA_DIR, leagueId, "closing_lines");

  const snap = loadJson<{ date: string; games: SnapshotGame[] }>(
    path.join(snapDir, `${date}.json`)
  );
  const resFile = loadJson<{ date: string; games: ResultGame[] }>(
    path.join(resDir, `${date}.json`)
  );
  const closeData = loadJson<{ date: string; games: ClosingLineGame[] }>(
    path.join(closeDir, `${date}.json`)
  );

  if (!snap) return null;

  // Use file-based results if available, otherwise fall back to live results
  const isLive = !resFile && !!liveResults?.length;
  const effectiveResults: ResultGame[] = resFile?.games ?? liveResults ?? [];

  // index results by ESPN team ID pair
  const resultByTeams = new Map<string, ResultGame>();
  for (const g of effectiveResults) {
    if (g.home_espnTeamId && g.away_espnTeamId) {
      resultByTeams.set(`${g.home_espnTeamId}|${g.away_espnTeamId}`, g);
    }
  }

  // index closing lines by oddsEventId
  const closingByEventId = new Map<string, ClosingLineGame>();
  for (const g of closeData?.games ?? []) {
    if (g.oddsEventId) closingByEventId.set(g.oddsEventId, g);
  }

  // Index intraday picks by oddsEventId for quick lookup
  const intradayByEvent = new Map<string, IntradayPick>();
  for (const ip of intradayPicks ?? []) {
    intradayByEvent.set(ip.oddsEventId, ip);
  }

  const games = snap.games.map((sg) => {
    const result =
      sg.home_espnTeamId && sg.away_espnTeamId
        ? resultByTeams.get(`${sg.home_espnTeamId}|${sg.away_espnTeamId}`) ?? null
        : null;

    const closing = sg.oddsEventId ? closingByEventId.get(sg.oddsEventId) ?? null : null;

    // Check for intraday pick: if the opener had signal=NONE but an intraday
    // pick was detected later, overlay it onto this game row.
    const openerSignal = sg.model?.signal ?? "NONE";
    const intraday = !isPlay(openerSignal) ? intradayByEvent.get(sg.oddsEventId) : undefined;

    // Use intraday pick data if available, otherwise use opener data
    const effectiveSignal = intraday?.signal ?? openerSignal;
    const effectiveEdge   = intraday?.edge ?? sg.model?.edge ?? null;
    const effectiveSpread = intraday ? intraday.openingHomePoint : (sg.opening?.homePoint ?? null);
    const effectiveBook   = intraday ? intraday.openingBook : (sg.opening?.book ?? null);
    const effectiveModelSpread = intraday ? intraday.modelSpread : (sg.model?.modelSpread ?? null);
    const pickedAt = intraday?.capturedAt ?? null;

    // Apply overrides: skip → force NONE, forceHome → correct neutral site
    const overrides = getGameOverrides(leagueId, date, sg.oddsEventId);
    const finalSignal = overrides.skip ? "NONE" : effectiveSignal;

    const pickResult = evaluatePick(
      finalSignal,
      effectiveEdge,
      effectiveSpread,
      result?.actualSpread ?? null
    );

    const pickSide: "HOME" | "AWAY" | "NONE" =
      !isPlay(finalSignal) || !effectiveEdge
        ? "NONE"
        : effectiveEdge < 0
        ? "HOME"
        : "AWAY";

    // For CLV, use raw edge direction regardless of signal threshold so
    // all games show whether the model direction beat the closing line.
    const clvEdge = effectiveEdge ?? sg.model?.edge ?? null;
    const clvPickSide: "HOME" | "AWAY" | "NONE" =
      clvEdge == null || clvEdge === 0
        ? "NONE"
        : clvEdge < 0
        ? "HOME"
        : "AWAY";

    const closingSpread = closing?.homePoint ?? null;
    const clv = computeClv(effectiveSpread, closingSpread, clvPickSide);

    // Juice-aware grading: units at the price on the line of record. Intraday
    // picks and older snapshots carry no price, so they grade at -110.
    const { price, assumed: priceAssumed } = pickPrice(pickSide, intraday ? null : sg.opening);
    const units = unitsFor(pickResult, price);

    return {
      date,
      home_team: sg.home_team,
      away_team: sg.away_team,
      home_espnTeamId: sg.home_espnTeamId ?? null,
      away_espnTeamId: sg.away_espnTeamId ?? null,
      neutral_site: overrides.forceHome ? false : (sg.neutralSite ?? false),
      opening_spread: effectiveSpread, // home spread (intraday line if applicable)
      opening_book: effectiveBook,
      closing_spread: closingSpread,
      clv,
      model_spread: effectiveModelSpread,
      edge: effectiveEdge,
      signal: finalSignal,
      pick_side: pickSide,
      // Override flags
      skipped: overrides.skip || undefined,
      forced_home: overrides.forceHome || undefined,
      override_reason: overrides.reason,
      // result
      home_score: result?.homeScore ?? null,
      away_score: result?.awayScore ?? null,
      actual_spread: result?.actualSpread ?? null,
      winner: result?.winner ?? null,
      completed: result?.completed ?? false,
      // evaluation
      pick_result: pickResult,
      pick_price: pickSide === "NONE" ? null : price,
      price_assumed: pickSide === "NONE" ? undefined : priceAssumed,
      units: units === null ? null : round2(units),
      // intraday metadata
      picked_at: pickedAt,
    };
  });

  // aggregate stats
  const picks = games.filter((g) => isPlay(g.signal));
  const decided = picks.filter((g) => g.pick_result === "WIN" || g.pick_result === "LOSS");
  const wins = decided.filter((g) => g.pick_result === "WIN").length;
  const strongPicks = picks.filter((g) => g.signal === "STRONG");
  const strongDecided = strongPicks.filter((g) => g.pick_result === "WIN" || g.pick_result === "LOSS");
  const strongWins = strongDecided.filter((g) => g.pick_result === "WIN").length;
  const inProgress = games.filter((g) => g.home_score !== null && !g.completed).length;

  return {
    date,
    snapshot_available: true,
    backfilled: date < LIVE_FROM,
    results_available: !!resFile || isLive,
    results_live: isLive,
    in_progress: inProgress,
    total_games: games.length,
    picks_made: picks.length,
    strong_picks: strongPicks.length,
    lean_picks: picks.filter((g) => g.signal === "LEAN").length,
    caution_games: games.filter((g) => g.signal === "CAUTION").length,
    record: decided.length > 0 ? `${wins}-${decided.length - wins}` : "pending",
    strong_record:
      strongDecided.length > 0
        ? `${strongWins}-${strongDecided.length - strongWins}`
        : "pending",
    win_pct: decided.length > 0 ? Math.round((wins / decided.length) * 100) : null,
    units: round2(picks.reduce((sum, g) => sum + (g.units ?? 0), 0)),
    games,
  };
}

// ---------------------------------------------------------------------------
// Roll-up across days
// ---------------------------------------------------------------------------

export type DayAnalysis = NonNullable<ReturnType<typeof analyzeDate>>;

export type RecordLine = {
  wins: number;
  losses: number;
  pushes: number;
  /** Net units at one unit risked per play, graded at the actual price. */
  units: number;
  /** units / plays settled, as a percentage. null when nothing has settled. */
  roi_pct: number | null;
  win_pct: number | null;
};

function line(games: DayAnalysis["games"]): RecordLine {
  const wins = games.filter((g) => g.pick_result === "WIN").length;
  const losses = games.filter((g) => g.pick_result === "LOSS").length;
  const pushes = games.filter((g) => g.pick_result === "PUSH").length;
  const units = games.reduce((sum, g) => sum + (g.units ?? 0), 0);
  const settled = wins + losses + pushes;
  return {
    wins,
    losses,
    pushes,
    units: round2(units),
    roi_pct: settled > 0 ? Math.round((units / settled) * 1000) / 10 : null,
    win_pct: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : null,
  };
}

/** Did the model's side of the line cover? null if no edge, no line or no final. */
function modelSideCovered(g: DayAnalysis["games"][number]): boolean | null {
  if (!g.completed || g.edge == null || g.edge === 0) return null;
  if (g.opening_spread == null || g.actual_spread == null) return null;
  const margin = g.actual_spread - g.opening_spread;
  if (Math.abs(margin) < 0.01) return null;
  const homeCovered = margin < 0;
  return g.edge < 0 ? homeCovered : !homeCovered;
}

/**
 * Season-to-date record from a set of analysed days.
 *  - plays:     LEAN + STRONG picks — the record that counts.
 *  - all_games: the model's side of every lined game, play or not. A sanity
 *               check on the model as a whole, not a betting record.
 *  - caution:   how CAUTION games would have done had they been played.
 */
export function summarize(days: DayAnalysis[]) {
  const games = days.flatMap((d) => d.games);
  const plays = games.filter((g) => isPlay(g.signal));

  const tally = (subset: typeof games) => {
    let correct = 0;
    let total = 0;
    for (const g of subset) {
      const c = modelSideCovered(g);
      if (c === null) continue;
      total++;
      if (c) correct++;
    }
    return {
      wins: correct,
      losses: total - correct,
      win_pct: total > 0 ? Math.round((correct / total) * 1000) / 10 : null,
    };
  };

  const clv = plays.filter((g) => g.clv !== null).map((g) => g.clv as number);
  const playRecord = line(plays);

  return {
    total_picks: plays.length,
    decided: playRecord.wins + playRecord.losses,
    wins: playRecord.wins,
    losses: playRecord.losses,
    pushes: playRecord.pushes,
    win_pct: playRecord.wins + playRecord.losses > 0
      ? Math.round((playRecord.wins / (playRecord.wins + playRecord.losses)) * 100)
      : null,
    units: playRecord.units,
    roi_pct: playRecord.roi_pct,
    plays: playRecord,
    lean: line(plays.filter((g) => g.signal === "LEAN")),
    strong: line(plays.filter((g) => g.signal === "STRONG")),
    all_games: tally(games),
    caution: tally(games.filter((g) => g.signal === "CAUTION")),
    avg_clv: clv.length > 0 ? round2(clv.reduce((a, b) => a + b, 0) / clv.length) : null,
    clv_games: clv.length,
    pending: plays.filter((g) => g.pick_result === "PENDING").length,
  };
}
