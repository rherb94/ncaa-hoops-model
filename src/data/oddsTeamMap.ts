// src/data/oddsTeamMap.ts
import fs from "node:fs";
import path from "node:path";
import { norm } from "@/data/espn";
import { getAllTeams, Team } from "@/data/teams";

type OddsToEspn = Record<string, string>;

let cachedOddsMap: OddsToEspn | null = null;
let cachedTeamsByEspnId: Map<string, Team> | null = null;

function loadOddsMap(): OddsToEspn {
  if (cachedOddsMap) return cachedOddsMap;
  const p = path.join(process.cwd(), "oddsTeamToEspnTeamId.json"); // adjust if it's elsewhere
  cachedOddsMap = fs.existsSync(p)
    ? JSON.parse(fs.readFileSync(p, "utf-8"))
    : {};
  return cachedOddsMap!;
}

function teamsByEspnId(): Map<string, Team> {
  if (cachedTeamsByEspnId) return cachedTeamsByEspnId;

  const m = new Map<string, Team>();
  for (const t of getAllTeams()) {
    if (t.espnTeamId) m.set(String(t.espnTeamId), t);
  }
  cachedTeamsByEspnId = m;
  return m;
}

export function resolveOddsTeamToTeam(oddsTeamNameRaw: string): {
  team?: Team;
  oddsKey: string;
  espnId?: string;
  reason?: string;
} {
  const oddsKey = norm(oddsTeamNameRaw);
  const oddsMap = loadOddsMap();

  const espnId = oddsMap[oddsKey];
  if (!espnId) {
    return { oddsKey, reason: "NO_ODDS_MAP_ENTRY" };
  }

  const team = teamsByEspnId().get(String(espnId));
  if (!team) {
    return { oddsKey, espnId, reason: "ESPN_ID_NOT_IN_TEAMS_CSV" };
  }

  return { oddsKey, espnId, team };
}
