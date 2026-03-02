// src/app/api/slate/route.ts
// Cleaned up + safer + consistent math.
// - Keeps response shape
// - Tunable shrinkage (env + query param support)
// - Uses computeEdge/computeSignal from model.ts (single source of truth)
// - Avoids edge=0 when market missing (uses undefined instead)
// - Optional debug logging per game
// - Keeps slate summary logging

import { NextResponse } from "next/server";
import { TheOddsApiProvider } from "@/lib/odds/providers/theOddsApi";
import { loadTeams } from "@/data/teams";
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

// final = market + α*(raw - market)
function shrinkTowardMarket(raw: number, market?: number, alpha = 0.35) {
  if (market === undefined) return raw;
  return round1(market + alpha * (raw - market));
}

function parseAlpha(reqUrl: URL) {
  // Priority: query param -> env -> default
  const qp = reqUrl.searchParams.get("alpha");
  const env = process.env.MODEL_SHRINK_ALPHA;

  const raw = qp ?? env ?? "0.35";
  const n = Number(raw);

  // keep it sane
  if (!Number.isFinite(n)) return 0.35;
  return clamp(n, 0, 1);
}

function parseDebug(reqUrl: URL) {
  return reqUrl.searchParams.get("debug") === "1";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }

  const alpha = parseAlpha(url);
  const debug = parseDebug(url);

  const provider = new TheOddsApiProvider();
  const oddsSlate = await provider.getSlate(date);

  const teams = loadTeams();
  const getTeam = (teamId: string) => teams.get(teamId);

  const games: SlateGame[] = (oddsSlate.games ?? []).map((g: any) => {
    const books = g.books ?? {};
    const consensus = pickConsensusFromBooks(books);

    const away = getTeam(g.awayTeamId);
    const home = getTeam(g.homeTeamId);

    const awayPR = away?.powerRating ?? 0;
    const homePR = home?.powerRating ?? 0;
    const hca = home?.hca ?? 2;

    // --- raw model spread ---
    const eff =
      home && away ? computeEfficiencyModel(home, away, hca) : undefined;
    const rawModelSpread =
      eff?.modelSpread ?? computeModelSpread(homePR, awayPR, hca);

    const marketSpread = consensus.spread;

    // Shrink model spread toward market to correct for systematic biases
    // (e.g. HCA underestimation causes raw model to over-favor away teams).
    // alpha=0 → pure market, alpha=1 → pure model. Default 0.35.
    const modelSpread = shrinkTowardMarket(rawModelSpread, marketSpread, alpha);

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
        rawModelSpread,
        alpha,
        modelSpread,
        edge,
        signal,
        // useful sanity checks
        usedEfficiency: Boolean(eff),
        hca,
        modelTotal,
      });
    }

    return {
      gameId: g.gameId,
      startTimeISO: g.startTimeISO,
      awayTeamId: g.awayTeamId,
      homeTeamId: g.homeTeamId,
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,

      awayLogo: away?.logo,
      homeLogo: home?.logo,

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
        modelSpread, // shrunken spread
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
    alpha,
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
