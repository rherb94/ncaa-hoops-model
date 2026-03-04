// src/data/teams.ts
import fs from "node:fs";
import path from "node:path";
import { resolveTeamId } from "./teamAliases";
import { loadEspnTeamsIndex, norm } from "@/data/espn";
import { ESPN_MASTER_MAP_BY_LEAGUE } from "@/data/espnMasterMap";
import type { LeagueId } from "@/lib/leagues";

const DEV = process.env.NODE_ENV !== "production";

export type Team = {
  teamId: string;
  name: string;
  conference?: string;
  powerRating: number;
  hca: number;
  logo?: string;
  espnTeamId?: string;

  // Torvik enrichments
  wins?: number;
  losses?: number;
  record?: string;

  barthag?: number;
  adjO?: number;
  adjD?: number;
  tempo?: number;

  torvikRank?: number;
  torvikOeRank?: number;
  torvikDeRank?: number;
};

type Parsed = { header: string[]; rows: string[][] };

// NOTE: Simple CSV parse (no quotes support). If you want robust CSV, see steps below.
function parseCsv(filePath: string): Parsed {
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return { header: [], rows: [] };

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((l) => l.split(",").map((s) => s.trim()));
  return { header, rows };
}

// Per-league caches: keyed by LeagueId
const cachedTeamsPerLeague = new Map<string, Map<string, Team>>();

// ---------------- ESPN matching ----------------

type EspnHit = { id?: string; name?: string; logo?: string };

// Hard-pins: local teamId -> ESPN id
const ESPN_PINNED_IDS: Record<string, string> = {
  "team-texas-aandm-corpus-chris": "357", // Texas A&M–Corpus Christi
};

/**
 * Synonyms keyed by norm(<team name>).
 */
const ESPN_SYNONYMS: Record<string, string[]> = {
  "miami fl": ["miami (fl)", "miami-fl", "university of miami", "miami"],
  "mcneese st": ["mcneese", "mcneese state", "mcneese-st", "mcneese st."],
  "sam houston st": [
    "sam houston",
    "sam houston state",
    "sam houston-st",
    "sam houston st.",
  ],
  seattle: ["seattle u", "seattle university", "university of seattle"],
  "cal baptist": ["california baptist", "cal baptist university", "cbu"],
  "illinois chicago": [
    "uic",
    "illinois-chicago",
    "university of illinois chicago",
  ],
  "nebraska omaha": [
    "omaha",
    "uno",
    "nebraska-omaha",
    "university of nebraska omaha",
  ],
  "nicholls st": ["nicholls", "nicholls state", "nicholls-st", "nicholls st."],
  "grambling st": [
    "grambling",
    "grambling state",
    "grambling-st",
    "grambling st.",
  ],
  albany: ["ualbany", "u albany", "university at albany"],
  "appalachian st": ["appalachian", "appalachian state", "app state", "app st"],

  "texas a&m corpus chris": [
    "texas a&m-corpus christi",
    "texas a&m corpus christi",
    "texas a&m cc",
    "texas a&m-cc",
    "a&m corpus christi",
    "tamu corpus christi",
    "tamcc",
  ],
  "texas a&m corpus christi": [
    "texas a&m-corpus christi",
    "texas a&m corpus christi",
    "texas a&m-cc",
    "tamu-cc",
    "tamu cc",
    "tamcc",
    "texas a and m corpus christi",
    "texas a and m cc",
    "texas a and m c c",
    "texas am cc",
  ],

  "southeastern louisiana": [
    "se louisiana",
    "se la",
    "southeastern la",
    "selu",
    "southeastern louisiana lions",
  ],
  "louisiana monroe": [
    "ulm",
    "ul monroe",
    "ul-monroe",
    "louisiana at monroe",
    "la monroe",
  ],

  "st francis": [
    "saint francis",
    "saint francis (pa)",
    "st francis (pa)",
    "st. francis (pa)",
  ],
  "saint francis": ["st francis", "saint francis (pa)", "st francis (pa)"],
};

function isCollisionRiskCandidate(candidate: string): boolean {
  const toks = norm(candidate).split(" ").filter(Boolean);
  return toks.length <= 1;
}

const TEAM_MATCH_TOKEN_REQUIREMENTS: Record<string, string[]> = {
  "team-miami-fl": ["miami"],
  "team-fiu": ["international", "panthers", "fiu"],
  "team-nebraska-omaha": ["omaha"],
  "team-st-francis-pa": ["francis"],
  "team-saint-francis": ["francis"],
};

function candidateSatisfiesTeamReq(teamId: string, candidate: string): boolean {
  const req = TEAM_MATCH_TOKEN_REQUIREMENTS[teamId];
  if (!req?.length) return true;

  const toks = new Set(norm(candidate).split(" ").filter(Boolean));
  return req.every((r) => toks.has(norm(r)));
}

function nameCandidates(name: string): string[] {
  const base = name.trim();
  const out = new Set<string>([base]);

  const noDots = base.replace(/\./g, "").trim();
  out.add(noDots);

  const m = base.match(/^(.+?)\s+([A-Z]{2})$/);
  if (m) out.add(`${m[1]} (${m[2]})`);

  const m2 = base.match(/^(.+?)\s+\(([A-Z]{2})\)$/);
  if (m2) out.add(`${m2[1]} ${m2[2]}`);

  out.add(base.replace(/^St\.\s+/i, "Saint "));
  out.add(base.replace(/^St\s+/i, "Saint "));
  out.add(base.replace(/^Saint\s+/i, "St. "));

  out.add(base.replace(/\s+St\.\s*$/i, " State"));
  out.add(base.replace(/\s+St\s*$/i, " State"));
  out.add(base.replace(/\s+State\s*$/i, " St."));
  out.add(base.replace(/\s+State\s*$/i, " St"));

  out.add(base.replace(/^Cal\s+St\.\s+/i, "Cal State "));
  out.add(base.replace(/^Cal\s+St\s+/i, "Cal State "));

  if (/\bCorpus\s+Chris\b/i.test(base)) {
    out.add(base.replace(/\bCorpus\s+Chris\b/i, "Corpus Christi"));
    out.add(noDots.replace(/\bCorpus\s+Chris\b/i, "Corpus Christi"));
  }

  const k1 = norm(base);
  const s1 = ESPN_SYNONYMS[k1];
  if (s1) for (const s of s1) out.add(s);

  const k2 = norm(noDots);
  const s2 = ESPN_SYNONYMS[k2];
  if (s2) for (const s of s2) out.add(s);

  const upper = base.toUpperCase();
  if (/^[A-Z]{2,8}$/.test(upper)) out.add(upper);

  return [...out];
}

type ResolveResult =
  | { method: "PINNED_TEAMID"; hit: EspnHit }
  | { method: "BY_ID"; hit: EspnHit }
  | { method: "BY_NAME"; hit: EspnHit; matchedCandidate: string }
  | { method: "MISS" };

function resolveEspnForTeam(
  team: Team,
  espnByName: Map<string, EspnHit>,
  espnById: Map<string, EspnHit>,
  league: LeagueId = "ncaam"
): ResolveResult {
  // 0) hard pin by teamId (strongest)
  const pinned = ESPN_PINNED_IDS[team.teamId];
  if (pinned) {
    const hit = espnById.get(String(pinned));
    if (hit) {
      console.log("[ESPN PIN HIT]", {
        teamId: team.teamId,
        teamName: team.name,
        pinned,
        hitId: hit.id,
        hitName: hit.name,
      });
      return { method: "PINNED_TEAMID", hit };
    }
    console.warn("[ESPN PIN MISS]", {
      teamId: team.teamId,
      teamName: team.name,
      pinned,
      reason: "espnById has no such id",
    });
  }

  // 1) existing espnTeamId
  if (team.espnTeamId) {
    const hit = espnById.get(String(team.espnTeamId));
    if (hit) return { method: "BY_ID", hit };
  }

  // 2) deterministic master map (teamId -> espnId)
  const masterMap = ESPN_MASTER_MAP_BY_LEAGUE[league] ?? {};
  const masterEspnId = masterMap[team.teamId];
  if (masterEspnId != null) {
    const hit = espnById.get(String(masterEspnId));
    if (hit) return { method: "BY_ID", hit };
    // The master map is authoritative even if the ESPN JSON doesn't have this
    // ID (NCAAW JSON only covers IDs ≤ 2124). Synthesize a CDN logo so the
    // team still gets a logo URL and espnTeamId rather than a MISS.
    const syntheticHit: EspnHit = {
      id: String(masterEspnId),
      logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${masterEspnId}.png`,
    };
    return { method: "BY_ID", hit: syntheticHit };
  }

  // 3) by-name fallback
  for (const cand of nameCandidates(team.name)) {
    if (!candidateSatisfiesTeamReq(team.teamId, cand)) continue;
    const hit = espnByName.get(norm(cand));
    if (hit) {
      if (isCollisionRiskCandidate(cand) && !ESPN_PINNED_IDS[team.teamId]) {
        console.warn(
          `[ESPN COLLISION_RISK] ${team.teamId} | "${team.name}" matchedCandidate="${cand}" -> "${hit.name}" (id=${hit.id})`
        );
      }
      return { method: "BY_NAME", hit, matchedCandidate: cand };
    }
  }

  return { method: "MISS" };
}

// ---------------- public API ----------------

export function loadTeams(league: LeagueId = "ncaam"): Map<string, Team> {
  if (!DEV && cachedTeamsPerLeague.has(league)) {
    return cachedTeamsPerLeague.get(league)!;
  }

  const filePath = path.join(process.cwd(), "src", "data", league, "teams.csv");
  if (!fs.existsSync(filePath)) {
    const m = new Map<string, Team>();
    if (!DEV) cachedTeamsPerLeague.set(league, m);
    return m;
  }

  // Internal alias map is no longer used here — alias resolution happens
  // via teamAliases.ts (resolveTeamId). Keeping the comment for reference.
  const aliases = new Map<string, string>();

  const espnIndex = loadEspnTeamsIndex(league) as any;
  const byName: Map<string, EspnHit> = (espnIndex?.byName ?? new Map()) as any;
  const byId: Map<string, EspnHit> = (espnIndex?.byId ?? new Map()) as any;

  const { header, rows } = parseCsv(filePath);

  const iTeamId = header.indexOf("teamId");
  const iName =
    header.indexOf("teamName") >= 0
      ? header.indexOf("teamName")
      : header.indexOf("name");
  const iConf = header.indexOf("conference");
  const iPR = header.indexOf("powerRating");
  const iHca = header.indexOf("hca");

  const iW = header.indexOf("wins");
  const iL = header.indexOf("losses");
  const iBarthag = header.indexOf("barthag");
  const iAdjO = header.indexOf("adjO");
  const iAdjD = header.indexOf("adjD");
  const iTempo = header.indexOf("tempo");
  const iTRank = header.indexOf("torvikRank");
  const iOERank = header.indexOf("torvikOeRank");
  const iDERank = header.indexOf("torvikDeRank");

  const missing: string[] = [];
  if (iTeamId < 0) missing.push("teamId");
  if (iName < 0) missing.push("name|teamName");
  if (iPR < 0) missing.push("powerRating");
  if (missing.length) {
    throw new Error(`teams.csv missing required columns: ${missing.join(",")}`);
  }

  const toNum = (v: any): number | undefined => {
    const n = Number(String(v ?? "").trim());
    return Number.isFinite(n) ? n : undefined;
  };

  const map = new Map<string, Team>();

  // Pass 1: load teams keyed by CSV teamId
  for (const r of rows) {
    const teamId = (r[iTeamId] ?? "").trim();
    if (!teamId) continue;

    const name = (r[iName] ?? "").trim();
    const conference = iConf >= 0 ? (r[iConf] ?? "").trim() : "";
    const powerRating = Number((r[iPR] ?? "").trim());
    const hca = iHca >= 0 ? Number((r[iHca] ?? "").trim()) : NaN;

    const wins = iW >= 0 ? toNum(r[iW]) : undefined;
    const losses = iL >= 0 ? toNum(r[iL]) : undefined;

    const barthag = iBarthag >= 0 ? toNum(r[iBarthag]) : undefined;
    const adjO = iAdjO >= 0 ? toNum(r[iAdjO]) : undefined;
    const adjD = iAdjD >= 0 ? toNum(r[iAdjD]) : undefined;
    const tempo = iTempo >= 0 ? toNum(r[iTempo]) : undefined;

    const torvikRank = iTRank >= 0 ? toNum(r[iTRank]) : undefined;
    const torvikOeRank = iOERank >= 0 ? toNum(r[iOERank]) : undefined;
    const torvikDeRank = iDERank >= 0 ? toNum(r[iDERank]) : undefined;

    map.set(teamId, {
      teamId,
      name,
      conference: conference || undefined,
      powerRating: Number.isFinite(powerRating) ? powerRating : 0,
      hca: Number.isFinite(hca) ? hca : 2,
      logo: undefined,
      espnTeamId: undefined,

      wins,
      losses,
      record:
        wins != null && losses != null
          ? `${Math.round(wins)}-${Math.round(losses)}`
          : undefined,

      barthag,
      adjO,
      adjD,
      tempo,

      torvikRank,
      torvikOeRank,
      torvikDeRank,
    });
  }

  // Pass 2: attach ESPN logo/id
  for (const [, team] of map.entries()) {
    const res = resolveEspnForTeam(team, byName, byId, league);

    if (team.teamId === "team-texas-aandm-corpus-chris") {
      console.log("[ESPN RESOLVE DEBUG]", {
        teamId: team.teamId,
        teamName: team.name,
        method: res.method,
        hitId: (res as any).hit?.id,
        hitName: (res as any).hit?.name,
        hitLogo: (res as any).hit?.logo,
      });
    }

    if (res.method !== "MISS") {
      team.logo = res.hit.logo;
      team.espnTeamId = res.hit.id;
    } else {
      console.warn(`[ESPN MISS] ${team.teamId} | ${team.name}`);
    }
  }

  // Convenience alias mapping (never overwrite real teams)
  for (const [aliasId, canonicalId] of aliases.entries()) {
    if (map.has(aliasId)) continue;
    const canonicalTeam = map.get(canonicalId);
    if (canonicalTeam) map.set(aliasId, canonicalTeam);
  }

  if (!DEV) cachedTeamsPerLeague.set(league, map);
  return map;
}

export function getTeam(input: any, league: LeagueId = "ncaam"): Team | undefined {
  const resolved = resolveTeamId(input);
  if (!resolved) return undefined;
  return loadTeams(league).get(resolved);
}

export function getAllTeams(league: LeagueId = "ncaam"): Team[] {
  const seen = new Set<string>();
  const out: Team[] = [];
  for (const t of loadTeams(league).values()) {
    if (seen.has(t.teamId)) continue;
    seen.add(t.teamId);
    out.push(t);
  }
  return out;
}
