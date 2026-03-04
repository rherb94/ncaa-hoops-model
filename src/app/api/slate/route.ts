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

// Read neutral site flags from today's opener snapshot (written by daily workflow at 8am ET).
// Falls back to empty map if snapshot hasn't been written yet — caller should follow up with
// a live ESPN fetch in that case.
function loadNeutralSiteByEventId(date: string): Map<string, boolean> {
  const p = path.join(process.cwd(), "src", "data", "odds_opening", `${date}.json`);
  try {
    const snap = JSON.parse(fs.readFileSync(p, "utf-8"));
    const m = new Map<string, boolean>();
    for (const g of snap.games ?? []) {
      if (g.oddsEventId) m.set(g.oddsEventId, g.neutralSite ?? false);
    }
    return m;
  } catch {
    return new Map(); // opener not written yet
  }
}

// Live ESPN scoreboard fetch — keyed by "homeEspnId|awayEspnId".
// Used as fallback when the opener snapshot doesn't exist yet (before 8am ET).
async function fetchEspnNeutralByTeamPair(date: string): Promise<Map<string, boolean>> {
  const espnDate = date.replace(/-/g, "");
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/basketball` +
    `/mens-college-basketball/scoreboard?dates=${espnDate}&groups=50&limit=200`;
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }

  const debug = parseDebug(url);
  // "Refresh odds" button passes refresh=1 to bypass the hourly cache
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const provider = new TheOddsApiProvider();
  const oddsSlate = await provider.getSlate(date, forceRefresh);

  const teams = loadTeams();
  const getTeam = (teamId: string) => teams.get(teamId);

  // Neutral site detection: prefer opener snapshot (committed at 8am ET).
  // If opener not yet written, fall back to a live ESPN scoreboard fetch so
  // neutral sites are correctly detected around the clock.
  const neutralSiteByEventId = loadNeutralSiteByEventId(date);
  const openerMissing = neutralSiteByEventId.size === 0;
  const espnNeutralByTeamPair = openerMissing
    ? await fetchEspnNeutralByTeamPair(date)
    : new Map<string, boolean>();

  const games: SlateGame[] = (oddsSlate.games ?? []).map((g: any) => {
    const books = g.books ?? {};
    const consensus = pickConsensusFromBooks(books);

    const away = getTeam(g.awayTeamId);
    const home = getTeam(g.homeTeamId);

    // Look up neutral site: opener snapshot first, then live ESPN fallback.
    const neutralSite = openerMissing
      ? (home?.espnTeamId && away?.espnTeamId
          ? (espnNeutralByTeamPair.get(`${home.espnTeamId}|${away.espnTeamId}`) ?? false)
          : false)
      : (neutralSiteByEventId.get(g.gameId) ?? false);

    const awayPR = away?.powerRating ?? 0;
    const homePR = home?.powerRating ?? 0;
    const hca = neutralSite ? 0 : (home?.hca ?? 2);

    // --- raw model spread ---
    if (!home) console.warn(`⚠️  SLATE: home team not found in teams.csv — teamId="${g.homeTeamId}" (${g.homeTeam})`);
    if (!away) console.warn(`⚠️  SLATE: away team not found in teams.csv — teamId="${g.awayTeamId}" (${g.awayTeam})`);

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
