// src/app/api/slate/route.ts
// Supports single-date (?date=YYYY-MM-DD) and all-upcoming (?mode=upcoming) modes.

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { TheOddsApiProvider } from "@/lib/odds/providers/theOddsApi";
import { loadTeams } from "@/data/teams";
import { getLeague } from "@/lib/leagues";
import type { LeagueConfig } from "@/lib/leagues";
import type { SlateGame, SlateResponse, UpcomingResponse, GameOverrideInfo } from "@/lib/types";
import { getGameOverrides } from "@/lib/overrides";
import { pickBestSpreadForSide } from "@/lib/odds/bestLines";
import type { OddsGame } from "@/lib/odds/types";
import {
  computeEfficiencyModel,
  computeModelSpread,
  computeEdge,
  computeSignal,
} from "@/lib/model";

type Consensus = {
  spread?: number;
  total?: number;
  moneylineHome?: number;
  moneylineAway?: number;
  source: string;
  updatedAtISO?: string;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function pickConsensusFromBooks(books: any): Consensus {
  const order = [
    "draftkings",
    "fanduel",
    "betmgm",
    "caesars",
    "pointsbet",
  ] as const;

  for (const k of order) {
    const lines = books?.[k];
    if (!lines) continue;

    const hasAnything =
      lines.spread !== undefined ||
      lines.total !== undefined ||
      lines.moneylineHome !== undefined ||
      lines.moneylineAway !== undefined;

    if (hasAnything) {
      return {
        spread: lines.spread,
        total: lines.total,
        moneylineHome: lines.moneylineHome,
        moneylineAway: lines.moneylineAway,
        source: k,
        updatedAtISO: lines.updatedAtISO,
      };
    }
  }

  const first = books ? Object.entries(books)[0] : undefined;
  if (first) {
    const [k, lines] = first as any;
    return {
      spread: lines?.spread,
      total: lines?.total,
      moneylineHome: lines?.moneylineHome,
      moneylineAway: lines?.moneylineAway,
      source: k ?? "provider",
      updatedAtISO: lines?.updatedAtISO,
    };
  }

  return { source: "provider" };
}

type OpenerInfo = { neutralSite: boolean; openingSpread?: number };

function loadOpenerInfoByEventId(date: string, leagueId: string): Map<string, OpenerInfo> {
  const p = path.join(process.cwd(), "src", "data", leagueId, "odds_opening", `${date}.json`);
  try {
    const snap = JSON.parse(fs.readFileSync(p, "utf-8"));
    const m = new Map<string, OpenerInfo>();
    for (const g of snap.games ?? []) {
      if (g.oddsEventId) {
        m.set(g.oddsEventId, {
          neutralSite: g.neutralSite ?? false,
          openingSpread: g.opening?.homePoint ?? undefined,
        });
      }
    }
    return m;
  } catch {
    return new Map();
  }
}

async function fetchEspnNeutralByTeamPair(date: string, league: LeagueConfig): Promise<Map<string, boolean>> {
  const espnDate = date.replace(/-/g, "");
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/basketball` +
    `/${league.espnSport}/scoreboard?dates=${espnDate}&groups=${league.espnGroupId}&limit=200`;
  const m = new Map<string, boolean>();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "ncaam-model/1.0 (personal project)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return m;
    const json = await res.json() as { events?: any[] };
    for (const event of json.events ?? []) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const neutral = comp.neutralSite ?? false;
      const home = comp.competitors?.find((c: any) => c.homeAway === "home");
      const away = comp.competitors?.find((c: any) => c.homeAway === "away");
      if (home?.id && away?.id) {
        m.set(`${home.id}|${away.id}`, neutral);
      }
    }
  } catch { /* ignore */ }
  return m;
}

/** Build SlateGame[] from raw OddsGame[] for a given date */
async function buildSlateGames(
  oddsGames: OddsGame[],
  date: string,
  league: LeagueConfig,
  teams: ReturnType<typeof loadTeams>,
  debug: boolean,
): Promise<SlateGame[]> {
  const getTeam = (teamId: string) => teams.get(teamId);

  const openerInfoByEventId = loadOpenerInfoByEventId(date, league.id);
  const openerMissing = openerInfoByEventId.size === 0;
  const espnNeutralByTeamPair = openerMissing
    ? await fetchEspnNeutralByTeamPair(date, league)
    : new Map<string, boolean>();

  const mappedGames = oddsGames.filter((g: any) => {
    const hasHome = getTeam(g.homeTeamId) !== undefined;
    const hasAway = getTeam(g.awayTeamId) !== undefined;
    if (!hasHome || !hasAway) {
      console.warn(
        `⚠️  SLATE: dropping game — missing model data:`,
        `${g.awayTeam} (${g.awayTeamId}) @ ${g.homeTeam} (${g.homeTeamId})`
      );
    }
    return hasHome && hasAway;
  });

  return mappedGames.map((g: any) => {
    const books = g.books ?? {};
    const consensus = pickConsensusFromBooks(books);

    const away = getTeam(g.awayTeamId);
    const home = getTeam(g.homeTeamId);

    const openerInfo = openerInfoByEventId.get(g.gameId);
    const rawNeutralSite = openerMissing
      ? (home?.espnTeamId && away?.espnTeamId
          ? (espnNeutralByTeamPair.get(`${home.espnTeamId}|${away.espnTeamId}`)
             ?? espnNeutralByTeamPair.get(`${away.espnTeamId}|${home.espnTeamId}`)
             ?? false)
          : false)
      : (openerInfo?.neutralSite ?? false);
    const openingSpread = openerInfo?.openingSpread;

    const overrides = getGameOverrides(league.id, date, g.gameId);
    const neutralSite = overrides.forceHome ? false : rawNeutralSite;

    const awayPR = away?.powerRating ?? 0;
    const homePR = home?.powerRating ?? 0;
    const hca = neutralSite ? 0 : (home?.hca ?? 2);

    const eff =
      home && away ? computeEfficiencyModel(home, away, hca) : undefined;

    if (home && away && !eff) {
      console.warn(`⚠️  SLATE EFFICIENCY FALLBACK: ${g.awayTeam} @ ${g.homeTeam} — missing adjO/adjD/tempo, using power rating spread`);
    }

    const rawModelSpread =
      eff?.modelSpread ?? computeModelSpread(homePR, awayPR, hca);

    const marketSpread = consensus.spread;
    const modelSpread = rawModelSpread;
    const modelTotal = eff?.modelTotal ?? consensus.total;

    const edgeRaw = computeEdge(modelSpread, marketSpread);
    const edge = edgeRaw === undefined ? undefined : clamp(edgeRaw, -12, 12);
    const rawSignal = computeSignal(edge);
    const signal = overrides.skip ? "NONE" as const : rawSignal;

    const preferredSide: "HOME" | "AWAY" | "NONE" =
      signal === "NONE" || edge === undefined
        ? "NONE"
        : edge < 0
        ? "HOME"
        : "AWAY";

    const best =
      preferredSide === "NONE"
        ? undefined
        : pickBestSpreadForSide(books, preferredSide);

    if (debug) {
      console.log("[GAME]", {
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        marketSpread,
        modelSpread,
        edge,
        signal,
        usedEfficiency: Boolean(eff),
        hca,
        modelTotal,
      });
    }

    return {
      gameId: g.gameId,
      startTimeISO: g.startTimeISO,
      neutralSite,
      awayTeamId: g.awayTeamId,
      homeTeamId: g.homeTeamId,
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,

      awayLogo: away?.logo,
      homeLogo: home?.logo,

      openingSpread,

      consensus: {
        spread: consensus.spread,
        total: consensus.total,
        moneylineHome: consensus.moneylineHome,
        moneylineAway: consensus.moneylineAway,
        source: consensus.source,
        updatedAtISO: consensus.updatedAtISO,
      },

      model: {
        awayPR,
        homePR,
        hca,
        modelSpread,
        edge: edge ?? 0,
        signal,
      },

      recommended:
        preferredSide === "NONE" || !best
          ? { market: "SPREAD", side: "NONE" }
          : {
              market: "SPREAD",
              side: preferredSide,
              line: best.line,
              book: best.book,
            },

      overrides:
        overrides.forceHome || overrides.skip
          ? {
              forceHome: overrides.forceHome || undefined,
              skip: overrides.skip || undefined,
              reason: overrides.reason,
            }
          : undefined,
    };
  });
}

function logSlateSummary(date: string, games: SlateGame[]) {
  const edges = games
    .map((g) => g.model.edge)
    .filter((n): n is number => typeof n === "number");

  const abs = edges.map((e) => Math.abs(e));
  const mean = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const buckets = edges.reduce<Record<string, number>>((acc, e) => {
    const a = Math.abs(e);
    const k =
      a >= 8 ? "8+" : a >= 6 ? "6-7.9" : a >= 4 ? "4-5.9" : a >= 3 ? "3-3.9" : a >= 2 ? "2-2.9" : "0-1.9";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const signals = games.reduce<Record<string, number>>((acc, g) => {
    acc[g.model.signal] = (acc[g.model.signal] ?? 0) + 1;
    return acc;
  }, {});

  console.log("[SLATE SUMMARY]", {
    date,
    games: games.length,
    avgAbsEdge: Number(mean(abs).toFixed(2)),
    maxAbsEdge: abs.length ? Number(Math.max(...abs).toFixed(2)) : 0,
    signals,
    buckets,
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league: leagueId } = await params;
  const league = getLeague(leagueId);

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const date = url.searchParams.get("date");
  const debug = url.searchParams.get("debug") === "1";
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const provider = new TheOddsApiProvider(league.sportKey, league.id);
  const teams = loadTeams(league.id);

  // ── Upcoming mode: return all dates with available odds ──
  if (mode === "upcoming") {
    let slatesByDate: Map<string, import("@/lib/odds/types").OddsSlate>;
    try {
      slatesByDate = await provider.getUpcoming(forceRefresh);
    } catch (e: any) {
      console.error(`[SLATE] TheOddsAPI failed:`, e?.message ?? e);
      return NextResponse.json(
        { error: `Odds provider error: ${e?.message ?? "unknown"}` },
        { status: 502 }
      );
    }

    const dates: UpcomingResponse["dates"] = [];
    const sortedDates = [...slatesByDate.keys()].sort();

    for (const d of sortedDates) {
      const slate = slatesByDate.get(d)!;
      const games = await buildSlateGames(slate.games, d, league, teams, debug);
      if (games.length > 0) {
        logSlateSummary(d, games);
        dates.push({ date: d, games });
      }
    }

    const body: UpcomingResponse = {
      lastUpdatedISO: new Date().toISOString(),
      dates,
    };
    return NextResponse.json(body);
  }

  // ── Single-date mode (default) ──
  if (!date) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }

  let oddsSlate;
  try {
    oddsSlate = await provider.getSlate(date, forceRefresh);
  } catch (e: any) {
    console.error(`[SLATE] TheOddsAPI failed for league=${league.id} sport=${league.sportKey}:`, e?.message ?? e);
    return NextResponse.json(
      { error: `Odds provider error: ${e?.message ?? "unknown"}` },
      { status: 502 }
    );
  }

  const games = await buildSlateGames(oddsSlate.games, date, league, teams, debug);
  logSlateSummary(date, games);

  const body: SlateResponse = {
    date,
    lastUpdatedISO: new Date().toISOString(),
    games,
    unmappedAliases: [],
  };

  return NextResponse.json(body);
}
