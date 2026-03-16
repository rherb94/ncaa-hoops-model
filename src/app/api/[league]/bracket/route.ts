// src/app/api/[league]/bracket/route.ts
// Fetches NCAA tournament bracket from ESPN and simulates using the model.

import { NextResponse } from "next/server";
import { loadTeams } from "@/data/teams";
import { getLeague } from "@/lib/leagues";
import type { Team } from "@/data/teams";
import {
  predictBracket,
  predictMatchup,
  simulateChampionshipProbs,
  getRoundName,
  type BracketTeam,
} from "@/lib/bracket";

type EspnCompetitor = {
  id: string;
  homeAway: "home" | "away";
  curatedRank?: { current?: number };
  team: {
    id: string;
    displayName: string;
    shortDisplayName: string;
    abbreviation: string;
    logo?: string;
    logos?: { href: string }[];
  };
  score?: string;
  winner?: boolean;
};

type EspnEvent = {
  id: string;
  date: string;
  name: string;
  status: {
    type: {
      completed: boolean;
      description: string;
    };
  };
  competitions: {
    id: string;
    neutralSite: boolean;
    competitors: EspnCompetitor[];
    notes?: { headline?: string }[];
    type?: { abbreviation?: string };
  }[];
};

function parseRegionAndRound(headline?: string): { region: string; round: string } | null {
  if (!headline) return null;
  // e.g. "NCAA Men's Basketball Championship - East Region - 1st Round"
  const parts = headline.split(" - ");
  if (parts.length < 3) return null;
  const region = parts[1]?.trim().replace(" Region", "");
  const round = parts[2]?.trim();
  return { region, round };
}

function roundStringToNumber(round: string): number {
  const lower = round.toLowerCase();
  if (lower.includes("first four") || lower.includes("play-in")) return 0;
  if (lower.includes("1st")) return 1;
  if (lower.includes("2nd")) return 2;
  if (lower.includes("sweet") || lower.includes("3rd")) return 3;
  if (lower.includes("elite") || lower.includes("4th")) return 4;
  if (lower.includes("semifinal") || lower.includes("final four")) return 5;
  if (lower.includes("championship") || lower.includes("national")) return 6;
  return 1;
}

function teamToBracketTeam(
  espnTeam: EspnCompetitor,
  modelTeam: Team | undefined,
  seed: number,
): BracketTeam {
  const logo = espnTeam.team.logos?.[0]?.href ?? espnTeam.team.logo;
  if (modelTeam) {
    return {
      teamId: modelTeam.teamId,
      name: modelTeam.name,
      seed,
      logo: modelTeam.logo ?? logo,
      powerRating: modelTeam.powerRating,
      record: modelTeam.record,
      conference: modelTeam.conference,
      adjO: modelTeam.adjO,
      adjD: modelTeam.adjD,
      tempo: modelTeam.tempo,
      barthag: modelTeam.barthag,
      torvikRank: modelTeam.torvikRank,
    };
  }
  // Fallback if team not in model
  return {
    teamId: `espn-${espnTeam.team.id}`,
    name: espnTeam.team.displayName,
    seed,
    logo,
    powerRating: 0,
  };
}

/** Fetch tournament games from ESPN across multiple dates */
async function fetchTournamentGames(
  espnSport: string,
): Promise<EspnEvent[]> {
  const allEvents: EspnEvent[] = [];
  // Tournament typically runs mid-March through early April
  // Scan dates where games might exist
  const today = new Date();
  const dates: string[] = [];

  // Generate dates from today through 3 weeks out (covers whole tournament)
  for (let i = -2; i <= 21; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
    dates.push(ymd);
  }

  // Fetch in parallel, batched
  const fetches = dates.map(async (dateStr) => {
    try {
      const url =
        `https://site.api.espn.com/apis/site/v2/sports/basketball` +
        `/${espnSport}/scoreboard?dates=${dateStr}&groups=100&limit=200`;
      const res = await fetch(url, {
        headers: { "user-agent": "ncaam-model/1.0 (personal project)" },
        next: { revalidate: 3600 },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { events?: EspnEvent[] };
      return json.events ?? [];
    } catch {
      return [];
    }
  });

  const results = await Promise.all(fetches);
  for (const events of results) {
    for (const event of events) {
      // Only include tournament games (avoid duplicates by ID)
      if (!allEvents.some((e) => e.id === event.id)) {
        allEvents.push(event);
      }
    }
  }

  return allEvents;
}

/** Find a model team by ESPN team ID */
function findModelTeamByEspnId(
  teams: Map<string, Team>,
  espnId: string,
): Team | undefined {
  for (const t of teams.values()) {
    if (t.espnTeamId === espnId) return t;
  }
  return undefined;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league: leagueId } = await params;
  const league = getLeague(leagueId);
  const teams = loadTeams(league.id);

  // Fetch tournament games from ESPN
  const events = await fetchTournamentGames(league.espnSport);

  if (events.length === 0) {
    return NextResponse.json({
      error: "No tournament games found. The bracket may not be available yet.",
      regions: [],
      finalFour: [],
      championship: null,
      champProbabilities: [],
      generatedAtISO: new Date().toISOString(),
    });
  }

  // Parse events into region -> seed -> team mappings
  const regionTeams = new Map<string, Map<number, BracketTeam>>();
  const firstFourTeams: { region: string; seed: number; teams: BracketTeam[] }[] = [];

  for (const event of events) {
    const comp = event.competitions[0];
    if (!comp) continue;

    const note = comp.notes?.[0]?.headline;
    const parsed = parseRegionAndRound(note);
    if (!parsed) continue;

    const { region, round } = parsed;
    const roundNum = roundStringToNumber(round);

    // Extract competitors
    for (const competitor of comp.competitors) {
      const seed = competitor.curatedRank?.current;
      if (!seed || seed === 99) continue; // 99 = TBD placeholder

      const modelTeam = findModelTeamByEspnId(teams, competitor.team.id);
      const bracketTeam = teamToBracketTeam(competitor, modelTeam, seed);

      // For First Four, track separately
      if (roundNum === 0) {
        let ff = firstFourTeams.find((f) => f.region === region && f.seed === seed);
        if (!ff) {
          ff = { region, seed, teams: [] };
          firstFourTeams.push(ff);
        }
        if (!ff.teams.some((t) => t.teamId === bracketTeam.teamId)) {
          ff.teams.push(bracketTeam);
        }
        continue;
      }

      if (!regionTeams.has(region)) regionTeams.set(region, new Map());
      const regionMap = regionTeams.get(region)!;
      // Don't overwrite if we already have this seed (from a different round)
      if (!regionMap.has(seed)) {
        regionMap.set(seed, bracketTeam);
      }
    }
  }

  // For First Four matchups: predict the winner and slot them into the bracket
  for (const ff of firstFourTeams) {
    if (ff.teams.length >= 2) {
      const { winner } = predictMatchup(ff.teams[0], ff.teams[1]);
      if (!regionTeams.has(ff.region)) regionTeams.set(ff.region, new Map());
      const regionMap = regionTeams.get(ff.region)!;
      if (!regionMap.has(ff.seed)) {
        regionMap.set(ff.seed, winner);
      }
    }
  }

  // Build region arrays for simulation
  const regionArray: { name: string; teams: BracketTeam[] }[] = [];
  const regionOrder = ["East", "West", "South", "Midwest"];

  for (const regionName of regionOrder) {
    const seedMap = regionTeams.get(regionName);
    if (!seedMap) continue;
    const teamsArr = Array.from(seedMap.values()).sort((a, b) => a.seed - b.seed);
    regionArray.push({ name: regionName, teams: teamsArr });
  }

  // Also include any regions not in the standard order
  for (const [regionName, seedMap] of regionTeams) {
    if (regionOrder.includes(regionName)) continue;
    const teamsArr = Array.from(seedMap.values()).sort((a, b) => a.seed - b.seed);
    regionArray.push({ name: regionName, teams: teamsArr });
  }

  // Run deterministic bracket prediction
  const prediction = predictBracket(regionArray);

  // Run Monte Carlo championship probabilities
  const champProbs = simulateChampionshipProbs(regionArray, 10000);

  // Build championship probability list sorted by probability
  const allTeams: BracketTeam[] = regionArray.flatMap((r) => r.teams);
  const champProbabilities = allTeams
    .map((team) => ({
      team,
      probability: champProbs.get(team.teamId) ?? 0,
    }))
    .filter((t) => t.probability > 0)
    .sort((a, b) => b.probability - a.probability);

  // Build response
  const response = {
    generatedAtISO: new Date().toISOString(),
    teamCount: allTeams.length,
    regionCount: regionArray.length,
    regions: prediction.regionResults.map((r) => ({
      name: r.name,
      teams: regionArray.find((ra) => ra.name === r.name)?.teams ?? [],
      rounds: r.rounds.map((matchups, i) => ({
        round: i + 1,
        name: getRoundName(i + 1),
        matchups: matchups.map((m) => ({
          matchupId: m.matchupId,
          topTeam: m.topTeam,
          bottomTeam: m.bottomTeam,
          predictedWinner: m.predictedWinner,
          predictedSpread: m.predictedSpread,
          winProbability: m.winProbability,
        })),
      })),
      winner: r.winner,
    })),
    finalFour: prediction.finalFour.map((m) => ({
      matchupId: m.matchupId,
      topTeam: m.topTeam,
      bottomTeam: m.bottomTeam,
      predictedWinner: m.predictedWinner,
      predictedSpread: m.predictedSpread,
      winProbability: m.winProbability,
    })),
    championship: {
      matchupId: prediction.championship.matchupId,
      topTeam: prediction.championship.topTeam,
      bottomTeam: prediction.championship.bottomTeam,
      predictedWinner: prediction.championship.predictedWinner,
      predictedSpread: prediction.championship.predictedSpread,
      winProbability: prediction.championship.winProbability,
    },
    champProbabilities: champProbabilities.slice(0, 30), // Top 30
  };

  return NextResponse.json(response);
}
