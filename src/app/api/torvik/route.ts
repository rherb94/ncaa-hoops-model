// src/app/api/torvik/route.ts
// Pass-through for Torvik's team-results CSV.
//
// Why this exists: barttorvik.com returns HTTP 403 to GitHub Actions runners,
// so the daily ratings workflow can't fetch the file directly. This route
// fetches it from Vercel's network instead and hands it back unchanged; the
// workflow points TORVIK_URL here.
//
//   GET /api/torvik?league=ncaam            → current season, men
//   GET /api/torvik?league=ncaaw&year=2027  → explicit season, women
//
// Deliberately narrow: it can only return those two files, it is never cached,
// and it is meant to be called once per league per day. If TORVIK_PROXY_SECRET
// is set in the environment, callers must send it as the x-proxy-secret header.

import { NextResponse } from "next/server";
import { basketballSeasonYear } from "@/lib/season";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

export async function GET(req: Request) {
  const secret = process.env.TORVIK_PROXY_SECRET;
  if (secret && req.headers.get("x-proxy-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const league = url.searchParams.get("league") ?? "ncaam";
  if (league !== "ncaam" && league !== "ncaaw") {
    return NextResponse.json({ error: "league must be ncaam or ncaaw" }, { status: 400 });
  }
  const yearParam = url.searchParams.get("year");
  if (yearParam && !/^20\d{2}$/.test(yearParam)) {
    return NextResponse.json({ error: "year must be a 4-digit year" }, { status: 400 });
  }
  const year = yearParam ?? String(basketballSeasonYear());

  const upstream =
    league === "ncaaw"
      ? `https://barttorvik.com/ncaaw/${year}_team_results.csv`
      : `https://barttorvik.com/${year}_team_results.csv`;

  let status = 0;
  let text = "";
  try {
    const res = await fetch(upstream, {
      cache: "no-store",
      headers: { "user-agent": UA, accept: "text/csv,text/plain;q=0.9,*/*;q=0.8" },
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    return NextResponse.json({ error: `Fetch failed: ${String(e)}`, upstream }, { status: 502 });
  }

  if (status !== 200 || !/^rank,team,/i.test(text.trimStart())) {
    return NextResponse.json(
      { error: "Torvik did not return the expected CSV", upstream, upstreamStatus: status, sample: text.slice(0, 120) },
      { status: 502 }
    );
  }

  return new Response(text, {
    headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" },
  });
}
