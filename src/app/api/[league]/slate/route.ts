// src/app/api/slate/route.ts
// Cleaned up + safer + consistent math.
// - Keeps response shape
// - Tunable shrinkage (env + query param support)
// - Uses computeEdge/computeSignal from model.ts (single source of truth)
// - Avoids edge=0 when market missing (uses undefined instead)
// - Optional debug logging per game
// - Keeps slate summary logging

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { TheOddsApiProvider } from "@/lib/odds/providers/theOddsApi";
import { loadTeams } from "@/data/teams";
import { getLeague } from "@/lib/leagues";
import type { LeagueConfig } from "@/lib/leagues";
import type { SlateGame, SlateResponse } from "@/lib/types";
import { pickBestSpreadForSide } from "@/lib/odds/bestLines";
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

function round1(n: number) {
  return Math.round(n * 10) / 10;
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

function parseDebug(reqUrl: URL) {
  return reqUrl.searchParams.get("debug") === "1";
}

type OpenerInfo = { neutralSite: boolean; openingSpread?: number };

// Read neutral site flags + opening spreads from today's opener snapshot.
// Falls back to empty map if snapshot hasn't been written yet.
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
    return new Map(); // opener not written yet
  }
}

// Live ESPN scoreboard fetch — keyed by "homeEspnId|awayEspnId".
// Used as fallback when the opener snapshot doesn't exist yet (before 8am ET).
async function fetchEspnNeutralByTeamPair(date: string, league: LeagueConfig): Promise<Map<string, boolean>> {
  const espnDate = date.replace(/-/g, "");
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/basketball` +
    `/${league.espnSport}/scoreboard?dates=${espnDate}&groups=${league.espnGroupId}&limit=200`;
  const m = new Map<string, boolean>();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "ncaam-model/1.0 (personal project)" },
      next: { revalidate: 3600 }, // cache for 1 hour in Next.js
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
  } catch { /* ignore — neutral site defaults to false */ }
  return m;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league: leagueId } = await params;
  const league = getLeague(leagueId);

  const url = new URL(req.url);
  const date = url.searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }

  const debug = parseDebug(url);
  // "Refresh odds" button passes refresh=1 to bypass the hourly cache
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const provider = new TheOddsApiProvider(league.sportKey, league.id);
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

  const teams = loadTeams(league.id);
  const getTeam = (teamId: string) => teams.get(teamId);

  // Opener snapshot info (neutral sites + opening spreads for line movement).
  // If opener not yet written, fall back to a live ESPN scoreboard fetch for neutral sites.
  const openerInfoByEventId = loadOpenerInfoByEventId(date, league.id);
  const openerMissing = openerInfoByEventId.size === 0;
  const espnNeutralByTeamPair = openerMissing
    ? await fetchEspnNeutralByTeamPair(date, league)
    : new Map<string, boolean>();

  // Only include games where both teams are in the model (i.e., in teams.csv).
  // Unmapped teams (resolveTeamId returned null) get placeholder IDs like
  // "unmapped-{eventId}-home" which will never be in the teams map.
  const mappedGames = (oddsSlate.games ?? []).filter((g: any) => {
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

  const games: SlateGame[] = mappedGames.map((g: any) => {
    const books = g.books ?? {};
    const consensus = pickConsensusFromBooks(books);

    const away = getTeam(g.awayTeamId);
    const home = getTeam(g.homeTeamId);

    // Look up opener info: neutral site + opening spread
    const openerInfo = openerInfoByEventId.get(g.gameId);
    const neutralSite = openerMissing
      ? (home?.espnTeamId && away?.espnTeamId
          ? (espnNeutralByTeamPair.get(`${home.espnTeamId}|${away.espnTeamId}`) ?? false)
          : false)
      : (openerInfo?.neutralSite ?? false);
    const openingSpread = openerInfo?.openingSpread;

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

    // --- totals (unchanged; just keep as "modelTotal" if you later expose it) ---
    const modelTotal = eff?.modelTotal ?? consensus.total;

    // --- edge/signal (single source of truth in lib/model.ts) ---
    const edgeRaw = computeEdge(modelSpread, marketSpread); // undefined if no market
    const edge = edgeRaw === undefined ? undefined : clamp(edgeRaw, -12, 12);
    const signal = computeSignal(edge);

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
        edge: edge ?? 0, // keep response shape if your UI expects number
        signal,
        // If your types allow it later:
        // modelTotal,
        // rawModelSpread,
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
    };
  });

  // ---- SLATE SUMMARY LOG ----
  const edges = games
    .map((g) => g.model.edge)
    .filter((n): n is number => typeof n === "number");

  const abs = edges.map((e) => Math.abs(e));

  const mean = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const buckets = edges.reduce<Record<string, number>>((acc, e) => {
    const a = Math.abs(e);
    const k =
      a >= 8
        ? "8+"
        : a >= 6
        ? "6-7.9"
        : a >= 4
        ? "4-5.9"
        : a >= 3
        ? "3-3.9"
        : a >= 2
        ? "2-2.9"
        : "0-1.9";
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

  const body: SlateResponse = {
    date,
    lastUpdatedISO: new Date().toISOString(),
    games,
    unmappedAliases: [],
  };

  return NextResponse.json(body);
}
