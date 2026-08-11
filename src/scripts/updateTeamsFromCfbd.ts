// src/scripts/updateTeamsFromCfbd.ts
// Populates src/data/cfb/teams.csv (ratings) and src/data/espnTeams.cfb.json
// (team metadata/logos) from the CollegeFootballData.com (CFBD) API.
//
// Unlike Torvik (basketball), CFBD is internally consistent: the same "team"/
// "school" name string is used across /teams/fbs, /ratings/sp, /stats/season/
// advanced, and /records, so no fuzzy name-matching is needed to join them —
// unlike the ESPN<->Torvik alias matching the basketball pipeline requires.
//
// We still write a synthetic "espnTeams.cfb.json" in the exact shape
// src/data/espn.ts expects, so src/data/teams.ts's existing ESPN-index
// resolution code path (loadEspnTeamsIndex / resolveEspnForTeam) works
// completely unchanged for cfb — just fed CFBD-sourced team/logo data
// instead of real ESPN data. The "espnTeamId" field it populates is really
// CFBD's numeric team id for cfb rows.
//
// Usage:
//   YEAR=2026 npx tsx src/scripts/updateTeamsFromCfbd.ts
//
// Ratings formula (see src/lib/model.ts computeFootballEfficiencyModel):
//   powerRating = SP+ overall rating (offense.rating - defense.rating + specialTeams.rating)
//   adjO        = SP+ offense.rating (points/game at the team's own pace)
//   adjD        = SP+ defense.rating (points/game allowed at the team's own pace)
//   tempo       = plays per game (offense.plays / games played)
//   hca         = uniform default for now (no per-venue CFB home-field-advantage
//                 dataset available yet, unlike ncaam's "True HF Edge chart");
//                 revisit once we have one.

import fs from "node:fs";
import path from "node:path";

const YEAR = process.env.YEAR ?? "2026";
const CFBD_API_KEY = process.env.CFBD_API_KEY;
if (!CFBD_API_KEY) {
  console.error("Missing env CFBD_API_KEY");
  process.exit(1);
}

const CFB_DEFAULT_HCA = 2.3;

const TEAMS_CSV = path.join(process.cwd(), "src", "data", "cfb", "teams.csv");
const ESPN_JSON = path.join(process.cwd(), "src", "data", "espnTeams.cfb.json");

type CfbdTeam = {
  id: number;
  school: string;
  mascot?: string;
  abbreviation?: string;
  conference?: string;
  classification?: string;
  logos?: string[];
};

type CfbdSpRating = {
  team: string;
  rating: number;
  ranking?: number;
  offense: { rating: number; ranking?: number };
  defense: { rating: number; ranking?: number };
  specialTeams?: { rating?: number };
};

type CfbdAdvancedStats = {
  team: string;
  offense: { plays?: number };
};

type CfbdRecord = {
  team: string;
  total: { games: number; wins: number; losses: number };
};

async function cfbdGet<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`https://api.collegefootballdata.com${pathAndQuery}`, {
    headers: {
      Authorization: `Bearer ${CFBD_API_KEY}`,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CFBD ${pathAndQuery} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

function slugifyTeamId(school: string): string {
  const base = school
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/'/g, "")
    .replace(/\./g, "")
    .replace(/[()]/g, "")
    .replace(/&/g, "and")
    .trim()
    .toLowerCase();

  const slug = base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `team-${slug}`;
}

function writeCsvFile(outPath: string, header: string[], rows: (string | number)[][]) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out =
    header.join(",") +
    "\n" +
    rows.map((r) => r.map((x) => x ?? "").join(",")).join("\n") +
    "\n";
  fs.writeFileSync(outPath, out, "utf-8");
}

async function fetchSpRatingsWithFallback(year: string): Promise<{ year: string; ratings: CfbdSpRating[] }> {
  const ratings = await cfbdGet<CfbdSpRating[]>(`/ratings/sp?year=${year}`);
  // Filter out the synthetic "nationalAverages" row CFBD includes in this endpoint.
  const real = ratings.filter((r) => r.team && r.team !== "nationalAverages" && r.offense && r.defense);

  // Early in a season (or preseason before CFBD has published updated SP+),
  // this can come back thin/empty. Bootstrap from the prior season's final
  // ratings rather than shipping an empty teams.csv.
  if (real.length < 50) {
    const prevYear = String(Number(year) - 1);
    console.warn(
      `⚠️  SP+ ratings for ${year} look incomplete (${real.length} teams) — falling back to ${prevYear} final ratings.`
    );
    const prev = await cfbdGet<CfbdSpRating[]>(`/ratings/sp?year=${prevYear}`);
    return { year: prevYear, ratings: prev.filter((r) => r.team && r.team !== "nationalAverages" && r.offense && r.defense) };
  }

  return { year, ratings: real };
}

async function main() {
  console.log(`Fetching CFBD team list for ${YEAR}...`);
  const teams = await cfbdGet<CfbdTeam[]>(`/teams/fbs?year=${YEAR}`);
  console.log(`  ${teams.length} FBS teams`);

  console.log(`Fetching SP+ ratings...`);
  const { year: ratingsYear, ratings } = await fetchSpRatingsWithFallback(YEAR);
  const ratingsByTeam = new Map(ratings.map((r) => [r.team, r]));
  if (ratingsYear !== YEAR) {
    console.log(`  Using ${ratingsYear} ratings as a stand-in until ${YEAR} SP+ data is published.`);
  }

  console.log(`Fetching advanced season stats (for plays/game pace proxy)...`);
  const advanced = await cfbdGet<CfbdAdvancedStats[]>(`/stats/season/advanced?year=${ratingsYear}`);
  const advancedByTeam = new Map(advanced.map((a) => [a.team, a]));

  console.log(`Fetching records (for games played + win/loss)...`);
  const records = await cfbdGet<CfbdRecord[]>(`/records?year=${ratingsYear}`);
  const recordsByTeam = new Map(records.map((r) => [r.team, r]));

  const csvRows: (string | number)[][] = [];
  const espnJsonTeams: any[] = [];
  const missingRatings: string[] = [];
  const missingPlays: string[] = [];

  for (const t of teams) {
    const sp = ratingsByTeam.get(t.school);
    const adv = advancedByTeam.get(t.school);
    const rec = recordsByTeam.get(t.school);

    if (!sp) {
      missingRatings.push(t.school);
      continue;
    }

    const games = rec?.total?.games;
    const plays = adv?.offense?.plays;
    const tempo = games && plays ? plays / games : undefined;
    if (!tempo) missingPlays.push(t.school);

    const teamId = slugifyTeamId(t.school);
    const powerRating = sp.rating;
    const adjO = sp.offense.rating;
    const adjD = sp.defense.rating;

    csvRows.push([
      teamId,
      t.school,
      t.conference ?? "",
      powerRating.toFixed(3),
      CFB_DEFAULT_HCA,
      adjO.toFixed(3),
      adjD.toFixed(3),
      tempo != null ? tempo.toFixed(3) : "",
      "", // barthag — no direct SP+ analog
      sp.ranking ?? "",
      sp.offense.ranking ?? "",
      sp.defense.ranking ?? "",
      rec?.total?.wins ?? "",
      rec?.total?.losses ?? "",
    ]);

    espnJsonTeams.push({
      id: String(t.id),
      displayName: t.mascot ? `${t.school} ${t.mascot}` : t.school,
      shortDisplayName: t.school,
      name: t.mascot ?? "",
      location: t.school,
      abbreviation: t.abbreviation ?? "",
      logos: t.logos?.length ? [{ href: t.logos[0], rel: ["default"] }] : undefined,
      logo: t.logos?.[0],
    });
  }

  writeCsvFile(
    TEAMS_CSV,
    [
      "teamId",
      "teamName",
      "conference",
      "powerRating",
      "hca",
      "adjO",
      "adjD",
      "tempo",
      "barthag",
      "torvikRank",
      "torvikOeRank",
      "torvikDeRank",
      "wins",
      "losses",
    ],
    csvRows
  );
  console.log(`✅ Wrote ${csvRows.length} teams to ${TEAMS_CSV}`);

  fs.mkdirSync(path.dirname(ESPN_JSON), { recursive: true });
  fs.writeFileSync(
    ESPN_JSON,
    JSON.stringify(
      { fetchedAtISO: new Date().toISOString(), count: espnJsonTeams.length, teams: espnJsonTeams },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`✅ Wrote ${espnJsonTeams.length} team logos/metadata to ${ESPN_JSON}`);

  if (missingRatings.length) {
    console.warn(`⚠️  ${missingRatings.length} FBS teams had no SP+ rating (dropped):`, missingRatings.join(", "));
  }
  if (missingPlays.length) {
    console.warn(`⚠️  ${missingPlays.length} teams missing plays/game (tempo left blank, model will skip them):`, missingPlays.join(", "));
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
