// src/app/api/[league]/team-l5/route.ts
// Returns the last 5 straight-up results for a team, fetched from ESPN's
// team schedule endpoint. Cached for 1 hour — results only change once per day.
//
// GET /api/[league]/team-l5?teamId=INTERNAL_TEAM_ID

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadTeams } from "@/data/teams";
import { getLeague } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";

export type L5Game = {
  result: "W" | "L";
  margin: number;       // positive = won by, negative = lost by
  opponent: string;     // short opponent name
  homeAway: "home" | "away";
};

export type L5Record = {
  wins: number;
  losses: number;
  streak: string;       // e.g. "W3" or "L2"
  games: L5Game[];      // chronological order — index 0 = oldest, 4 = most recent
};

function parseScore(score: unknown): number {
  if (typeof score === "number") return score;
  if (typeof score === "string") return parseFloat(score) || 0;
  if (score && typeof score === "object") {
    const s = score as Record<string, unknown>;
    if (s.value !== undefined) return parseFloat(String(s.value)) || 0;
    if (s.displayValue !== undefined) return parseFloat(String(s.displayValue)) || 0;
  }
  return 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league: leagueId } = await params;
  const league = getLeague(leagueId);

  const teamId = req.nextUrl.searchParams.get("teamId");
  if (!teamId) {
    return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  }

  const teams = loadTeams(league.id as LeagueId);
  const team = teams.get(teamId);
  const espnId = (team as any)?.espnTeamId as string | undefined;

  if (!espnId) {
    return NextResponse.json({ error: "No ESPN ID for team" }, { status: 404 });
  }

  const schedUrl =
    `https://site.api.espn.com/apis/site/v2/sports/basketball` +
    `/${league.espnSport}/teams/${espnId}/schedule`;

  const res = await fetch(schedUrl, {
    headers: { "user-agent": "hoops-model/1.0 (personal project)" },
    next: { revalidate: 3600 }, // cache 1 hour — only updates once/day
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `ESPN schedule failed (${res.status})` },
      { status: 502 }
    );
  }

  const json = (await res.json()) as { events?: any[] };

  // Completed games only → take last 5 (chronological order, oldest first)
  const completed = (json.events ?? []).filter((ev: any) => {
    const comp = ev.competitions?.[0];
    return comp?.status?.type?.completed === true;
  });
  const last5 = completed.slice(-5);

  const games: L5Game[] = last5.map((ev: any) => {
    const comp = ev.competitions[0];
    const me = comp.competitors?.find(
      (c: any) => String(c.team?.id) === String(espnId)
    );
    const opp = comp.competitors?.find(
      (c: any) => String(c.team?.id) !== String(espnId)
    );

    const myScore = parseScore(me?.score);
    const oppScore = parseScore(opp?.score);

    return {
      result: me?.winner === true ? "W" : "L",
      margin: Math.round(myScore - oppScore),
      opponent:
        opp?.team?.shortDisplayName ??
        opp?.team?.displayName ??
        "Unknown",
      homeAway: me?.homeAway === "home" ? "home" : "away",
    };
  });

  const wins = games.filter((g) => g.result === "W").length;
  const losses = games.length - wins;

  // Streak: walk backward from most recent game
  let streak = "";
  if (games.length > 0) {
    const reversed = [...games].reverse();
    const dir = reversed[0].result;
    let count = 0;
    for (const g of reversed) {
      if (g.result !== dir) break;
      count++;
    }
    streak = `${dir}${count}`;
  }

  const record: L5Record = { wins, losses, streak, games };
  return NextResponse.json(record);
}
