import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadTeams } from "@/data/teams";
import { getLeague } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";

function buildRecord(team: any): string | null {
  const w = Number(team.wins);
  const l = Number(team.losses);
  if (Number.isFinite(w) && Number.isFinite(l)) {
    return `${w}-${l}`;
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league: leagueId } = await params;
  getLeague(leagueId); // validate — throws on unknown league

  const teamId = req.nextUrl.searchParams.get("teamId");
  if (!teamId) {
    return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  }

  const teams = loadTeams(leagueId as LeagueId);
  const team = teams.get(teamId);

  if (!team) {
    return NextResponse.json(
      { error: `Unknown teamId ${teamId}` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    teamId: team.teamId,
    teamName: team.name,
    conference: team.conference ?? null,

    // ✅ display-friendly record
    record: buildRecord(team),

    // ✅ keep numeric PR for reference / debugging
    powerRating: team.powerRating ?? null,

    // ✅ NEW: rank-based PR for UI
    powerRank: (team as any).torvikRank ?? null,

    // efficiency metrics
    adjOff: (team as any).adjO ?? null,
    adjDef: (team as any).adjD ?? null,
    tempo: (team as any).tempo ?? null,
    barthag: (team as any).barthag ?? null,

    // ✅ ranks from Torvik
    ranks: {
      adjOff: (team as any).torvikOeRank ?? null,
      adjDef: (team as any).torvikDeRank ?? null,
      barthag: (team as any).torvikRank ?? null,
      tempo: null, // Torvik team_results.csv does not include tempo rank directly
    },
  });
}
