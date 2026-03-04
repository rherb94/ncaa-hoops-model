// src/app/api/[league]/teams/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllTeams } from "@/data/teams";
import { getLeague } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league: leagueId } = await params;
  getLeague(leagueId); // validate — throws on unknown league
  return NextResponse.json({ teams: getAllTeams(leagueId as LeagueId) });
}
