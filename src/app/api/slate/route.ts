import { NextResponse } from "next/server";
import { TheOddsApiProvider } from "@/lib/odds/providers/theOddsApi";
import { loadTeams } from "@/data/teams";
import type { SlateGame, SlateResponse } from "@/lib/types";
import { pickBestSpreadForSide } from "@/lib/odds/bestLines";
import { computeModelSpread } from "@/lib/model";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function computeSignal(edge: number): "NONE" | "LEAN" | "STRONG" {
  const a = Math.abs(edge);
  if (a >= 5) return "STRONG";
  if (a >= 3) return "LEAN";
  return "NONE";
}

type Consensus = {
  spread?: number;
  total?: number;
  moneylineHome?: number;
  moneylineAway?: number;
  source: string;
  updatedAtISO?: string;
};

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }

  const provider = new TheOddsApiProvider();
  const oddsSlate = await provider.getSlate(date);

  const teams = loadTeams();
  const getTeam = (teamId: string) => teams.get(teamId);

  const games: SlateGame[] = (oddsSlate.games ?? []).map((g: any) => {
    const books = g.books ?? {};

    const away = getTeam(g.awayTeamId);
    const home = getTeam(g.homeTeamId);

    const consensus = pickConsensusFromBooks(books);

    const awayPR = away?.powerRating ?? 0;
    const homePR = home?.powerRating ?? 0;
    const hca = home?.hca ?? 2;

    const modelSpread = computeModelSpread(homePR, awayPR, hca);

    // Edge uses HOME spread convention
    const marketSpread = consensus.spread;
    const edge =
      marketSpread === undefined
        ? 0
        : clamp(modelSpread - marketSpread, -12, 12);

    const signal = computeSignal(edge);

    const preferredSide: "HOME" | "AWAY" | "NONE" =
      signal === "NONE" ? "NONE" : edge < 0 ? "HOME" : "AWAY";

    const best =
      preferredSide === "NONE"
        ? undefined
        : pickBestSpreadForSide(books, preferredSide);

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
        modelSpread,
        edge,
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
    };
  });

  const body: SlateResponse = {
    date,
    lastUpdatedISO: new Date().toISOString(),
    games,
    unmappedAliases: [],
  };

  return NextResponse.json(body);
}
