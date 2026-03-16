// src/lib/bracket.ts
// NCAA Tournament bracket simulation using the efficiency model.

import type { Team } from "@/data/teams";
import { computeEfficiencyModel } from "./model";

export type BracketTeam = {
  teamId: string;
  name: string;
  seed: number;
  logo?: string;
  // Torvik data
  powerRating: number;
  record?: string;
  conference?: string;
  adjO?: number;
  adjD?: number;
  tempo?: number;
  barthag?: number;
  torvikRank?: number;
};

export type BracketMatchup = {
  matchupId: string;
  round: number; // 0 = first four, 1 = R64, 2 = R32, 3 = S16, 4 = E8, 5 = F4, 6 = NCG
  region: string;
  topTeam?: BracketTeam;
  bottomTeam?: BracketTeam;
  predictedWinner?: BracketTeam;
  predictedSpread?: number; // from winner's perspective (always negative)
  winProbability?: number; // predicted winner's win probability
  // If the game has already been played
  completed?: boolean;
  actualWinner?: BracketTeam;
  topScore?: number;
  bottomScore?: number;
};

export type BracketRegion = {
  name: string;
  matchups: BracketMatchup[];
};

export type BracketData = {
  regions: BracketRegion[];
  finalFour: BracketMatchup[];
  championship: BracketMatchup;
  generatedAtISO: string;
  // Championship probabilities for each team
  champProbabilities?: { team: BracketTeam; probability: number }[];
};

const ROUND_NAMES: Record<number, string> = {
  0: "First Four",
  1: "Round of 64",
  2: "Round of 32",
  3: "Sweet 16",
  4: "Elite 8",
  5: "Final Four",
  6: "Championship",
};

export function getRoundName(round: number): string {
  return ROUND_NAMES[round] ?? `Round ${round}`;
}

/** Convert a model spread (home spread convention) to a win probability using a logistic function */
export function spreadToWinProb(spread: number): number {
  // spread is in "home spread" convention (negative = home favored)
  // We convert to: probability that the FAVORITE wins
  // Using logistic model calibrated for college basketball
  // sigma ≈ 11 points (typical SD of margin in college basketball)
  const sigma = 11;
  const margin = -spread; // positive = home team's expected margin
  return 1 / (1 + Math.exp(-margin * (Math.PI / (sigma * Math.sqrt(3)))));
}

/** Predict a matchup between two teams. All tournament games are neutral site. */
export function predictMatchup(
  teamA: BracketTeam,
  teamB: BracketTeam,
): {
  winner: BracketTeam;
  loser: BracketTeam;
  spread: number;
  winProb: number;
} {
  // Build minimal Team objects for the efficiency model
  const homeTeam: Team = {
    teamId: teamA.teamId,
    name: teamA.name,
    powerRating: teamA.powerRating,
    hca: 0, // neutral site
    adjO: teamA.adjO,
    adjD: teamA.adjD,
    tempo: teamA.tempo,
    barthag: teamA.barthag,
  };

  const awayTeam: Team = {
    teamId: teamB.teamId,
    name: teamB.name,
    powerRating: teamB.powerRating,
    hca: 0,
    adjO: teamB.adjO,
    adjD: teamB.adjD,
    tempo: teamB.tempo,
    barthag: teamB.barthag,
  };

  // HCA = 0 for all tournament games (neutral site)
  const eff = computeEfficiencyModel(homeTeam, awayTeam, 0);

  let modelSpread: number;
  if (eff) {
    modelSpread = eff.modelSpread;
  } else {
    // Fallback to power rating difference
    const margin = teamA.powerRating - teamB.powerRating;
    modelSpread = -margin; // home spread convention
  }

  // modelSpread < 0 means teamA (home) is favored
  // modelSpread > 0 means teamB (away) is favored
  const teamAWinProb = spreadToWinProb(modelSpread);

  if (teamAWinProb >= 0.5) {
    return {
      winner: teamA,
      loser: teamB,
      spread: Math.round(modelSpread * 10) / 10,
      winProb: Math.round(teamAWinProb * 1000) / 1000,
    };
  } else {
    return {
      winner: teamB,
      loser: teamA,
      spread: Math.round(-modelSpread * 10) / 10, // flip to winner's perspective
      winProb: Math.round((1 - teamAWinProb) * 1000) / 1000,
    };
  }
}

/** Run a Monte Carlo simulation to estimate championship probabilities */
export function simulateChampionshipProbs(
  regions: { name: string; teams: BracketTeam[] }[],
  numSims: number = 10000,
): Map<string, number> {
  const champCounts = new Map<string, number>();

  for (let sim = 0; sim < numSims; sim++) {
    // Simulate each region to get Final Four
    const finalFourTeams: BracketTeam[] = [];

    for (const region of regions) {
      // Standard 16-team bracket seeding: 1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15
      const seedOrder = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
      const teamsBySeed = new Map<number, BracketTeam>();
      for (const t of region.teams) teamsBySeed.set(t.seed, t);

      let bracket: BracketTeam[] = seedOrder
        .map((s) => teamsBySeed.get(s))
        .filter((t): t is BracketTeam => t !== undefined);

      // Simulate rounds
      while (bracket.length > 1) {
        const nextRound: BracketTeam[] = [];
        for (let i = 0; i < bracket.length; i += 2) {
          if (i + 1 >= bracket.length) {
            nextRound.push(bracket[i]);
            continue;
          }
          const result = predictMatchup(bracket[i], bracket[i + 1]);
          // Use probability to randomly pick winner
          const rand = Math.random();
          if (rand < result.winProb) {
            nextRound.push(result.winner);
          } else {
            nextRound.push(result.loser);
          }
        }
        bracket = nextRound;
      }

      if (bracket.length > 0) finalFourTeams.push(bracket[0]);
    }

    // Simulate Final Four (semi-finals)
    if (finalFourTeams.length >= 4) {
      const semi1 = simulateGame(finalFourTeams[0], finalFourTeams[1]);
      const semi2 = simulateGame(finalFourTeams[2], finalFourTeams[3]);
      const champ = simulateGame(semi1, semi2);
      champCounts.set(champ.teamId, (champCounts.get(champ.teamId) ?? 0) + 1);
    }
  }

  // Convert to probabilities
  const probs = new Map<string, number>();
  for (const [teamId, count] of champCounts) {
    probs.set(teamId, count / numSims);
  }
  return probs;
}

function simulateGame(a: BracketTeam, b: BracketTeam): BracketTeam {
  const result = predictMatchup(a, b);
  return Math.random() < result.winProb ? result.winner : result.loser;
}

/** Build a deterministic bracket prediction (always pick the model's favorite) */
export function predictBracket(
  regions: { name: string; teams: BracketTeam[] }[],
): {
  regionResults: {
    name: string;
    rounds: BracketMatchup[][];
    winner: BracketTeam;
  }[];
  finalFour: BracketMatchup[];
  championship: BracketMatchup;
} {
  const regionResults: {
    name: string;
    rounds: BracketMatchup[][];
    winner: BracketTeam;
  }[] = [];

  const finalFourTeams: BracketTeam[] = [];

  for (const region of regions) {
    const seedOrder = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
    const teamsBySeed = new Map<number, BracketTeam>();
    for (const t of region.teams) teamsBySeed.set(t.seed, t);

    let bracket: BracketTeam[] = seedOrder
      .map((s) => teamsBySeed.get(s))
      .filter((t): t is BracketTeam => t !== undefined);

    const rounds: BracketMatchup[][] = [];
    let roundNum = 1;

    while (bracket.length > 1) {
      const roundMatchups: BracketMatchup[] = [];
      const nextRound: BracketTeam[] = [];

      for (let i = 0; i < bracket.length; i += 2) {
        if (i + 1 >= bracket.length) {
          nextRound.push(bracket[i]);
          continue;
        }

        const result = predictMatchup(bracket[i], bracket[i + 1]);
        roundMatchups.push({
          matchupId: `${region.name}-R${roundNum}-${i / 2}`,
          round: roundNum,
          region: region.name,
          topTeam: bracket[i],
          bottomTeam: bracket[i + 1],
          predictedWinner: result.winner,
          predictedSpread: result.spread,
          winProbability: result.winProb,
        });
        nextRound.push(result.winner);
      }

      rounds.push(roundMatchups);
      bracket = nextRound;
      roundNum++;
    }

    const winner = bracket[0];
    regionResults.push({ name: region.name, rounds, winner });
    if (winner) finalFourTeams.push(winner);
  }

  // Final Four
  const finalFour: BracketMatchup[] = [];
  const champTeams: BracketTeam[] = [];

  if (finalFourTeams.length >= 4) {
    // Semi 1: Region 1 winner vs Region 2 winner
    const semi1 = predictMatchup(finalFourTeams[0], finalFourTeams[1]);
    finalFour.push({
      matchupId: "F4-1",
      round: 5,
      region: "Final Four",
      topTeam: finalFourTeams[0],
      bottomTeam: finalFourTeams[1],
      predictedWinner: semi1.winner,
      predictedSpread: semi1.spread,
      winProbability: semi1.winProb,
    });
    champTeams.push(semi1.winner);

    // Semi 2: Region 3 winner vs Region 4 winner
    const semi2 = predictMatchup(finalFourTeams[2], finalFourTeams[3]);
    finalFour.push({
      matchupId: "F4-2",
      round: 5,
      region: "Final Four",
      topTeam: finalFourTeams[2],
      bottomTeam: finalFourTeams[3],
      predictedWinner: semi2.winner,
      predictedSpread: semi2.spread,
      winProbability: semi2.winProb,
    });
    champTeams.push(semi2.winner);
  }

  // Championship
  let championship: BracketMatchup;
  if (champTeams.length >= 2) {
    const ncg = predictMatchup(champTeams[0], champTeams[1]);
    championship = {
      matchupId: "NCG",
      round: 6,
      region: "Championship",
      topTeam: champTeams[0],
      bottomTeam: champTeams[1],
      predictedWinner: ncg.winner,
      predictedSpread: ncg.spread,
      winProbability: ncg.winProb,
    };
  } else {
    championship = {
      matchupId: "NCG",
      round: 6,
      region: "Championship",
    };
  }

  return { regionResults, finalFour, championship };
}
