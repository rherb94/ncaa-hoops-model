// src/scripts/fetchEspnTeams.ts
import fs from "node:fs";
import path from "node:path";

// LEAGUE env var: "ncaam" (default) or "ncaaw"
const LEAGUE = (process.env.LEAGUE ?? "ncaam").toLowerCase();
const ESPN_SPORT =
  LEAGUE === "ncaaw" ? "womens-college-basketball" : "mens-college-basketball";

// Output file: espnTeams.json (ncaam) or espnTeams.ncaaw.json (ncaaw)
const OUT_FILE = LEAGUE === "ncaaw" ? "espnTeams.ncaaw.json" : "espnTeams.json";
const OUT = path.join(process.cwd(), "src", "data", OUT_FILE);

console.log(`League: ${LEAGUE} | ESPN sport: ${ESPN_SPORT} | Output: ${OUT_FILE}`);

// ✅ Use ESPN "core" API (this is the one that tends to include the full NCAA list)
const CORE_BASE = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/${ESPN_SPORT}/teams`;

// Optional fallback (what you were using before)
const SITE_BASE = `https://site.api.espn.com/apis/site/v2/sports/basketball/${ESPN_SPORT}/teams`;

type EspnTeam = {
  id: string;
  displayName?: string;
  name?: string;
  nickname?: string;
  abbreviation?: string;
  location?: string;
  logos?: { href: string; rel?: string[] }[];
  logo?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "ncaam-model/1.0 (personal project)",
      accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 300)}`);
  }
  return res.json();
}

// -------- Core API helpers --------

function extractRefsFromCoreList(payload: any): string[] {
  // Core list shape usually:
  // { count, pageIndex, pageSize, items: [{ $ref: "..." }, ...] }
  const items = payload?.items ?? [];
  const refs: string[] = [];
  for (const it of items) {
    const ref = it?.$ref;
    if (typeof ref === "string") refs.push(ref);
  }
  return refs;
}

function normalizeTeamFromCore(team: any): EspnTeam | null {
  if (!team?.id) return null;

  const logos = team?.logos ?? (team?.logo ? [{ href: team.logo }] : undefined);

  return {
    id: String(team.id),
    displayName: team.displayName ?? team?.fullName ?? undefined,
    name: team.name ?? undefined,
    nickname: team.nickname ?? undefined,
    abbreviation: team.abbreviation ?? undefined,
    location: team.location ?? undefined,
    logos,
    logo: team.logo ?? (logos?.[0]?.href ? String(logos[0].href) : undefined),
  };
}

// -------- Site API fallback helpers --------

function extractTeamsFromSite(payload: any): any[] {
  // ESPN sometimes returns:
  // 1) { sports: [{ leagues: [{ teams: [{ team: {...}} ] }]}]}
  // 2) { teams: [{ team: {...}}] } or { teams: [{...}] }
  const candidates: any[] =
    payload?.sports?.[0]?.leagues?.[0]?.teams ??
    payload?.teams ??
    payload?.items ??
    [];

  const teams: any[] = [];
  for (const item of candidates) {
    const t = item?.team ?? item;
    if (t?.id) teams.push(t);
  }
  return teams;
}

function normalizeTeamFromSite(t: any): EspnTeam {
  const logos = t?.logos ?? (t?.logo ? [{ href: t.logo }] : undefined);
  return {
    id: String(t.id),
    displayName: t.displayName ?? undefined,
    name: t.name ?? undefined,
    nickname: t.nickname ?? undefined,
    abbreviation: t.abbreviation ?? undefined,
    location: t.location ?? undefined,
    logos,
    logo: t.logo ?? (logos?.[0]?.href ? String(logos[0].href) : undefined),
  };
}

// Simple concurrency limiter (no deps)
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return out;
}

async function fetchViaCore() {
  console.log("Fetching ESPN teams via CORE api…");

  const limit = 500;
  let offset = 0;

  const refs: string[] = [];
  while (true) {
    const url = `${CORE_BASE}?limit=${limit}&offset=${offset}`;
    console.log(`GET ${url}`);
    const payload = await fetchJson(url);

    const batchRefs = extractRefsFromCoreList(payload);
    console.log(`  refs: ${batchRefs.length}`);

    refs.push(...batchRefs);

    if (batchRefs.length < limit) break;
    offset += limit;
    await sleep(150);
  }

  // De-dupe refs
  const uniqueRefs = Array.from(new Set(refs));
  console.log(`Total unique team refs: ${uniqueRefs.length}`);

  const byId = new Map<string, EspnTeam>();

  // Fetch each team detail (core list returns $ref stubs)
  const teams = await mapLimit(uniqueRefs, 12, async (ref, idx) => {
    // be polite-ish
    if (idx % 25 === 0) await sleep(80);

    const teamPayload = await fetchJson(ref);
    const team = normalizeTeamFromCore(teamPayload);
    return team;
  });

  for (const t of teams) {
    if (t?.id) byId.set(String(t.id), t);
  }

  return Array.from(byId.values()).sort((a, b) => Number(a.id) - Number(b.id));
}

async function fetchViaSiteFallback() {
  console.log("Fetching ESPN teams via SITE api fallback…");

  const limit = 700;
  let offset = 0;

  const byId = new Map<string, EspnTeam>();

  while (true) {
    const url = `${SITE_BASE}?limit=${limit}&offset=${offset}`;
    console.log(`GET ${url}`);
    const payload = await fetchJson(url);

    const batch = extractTeamsFromSite(payload);
    console.log(`  batch size: ${batch.length}`);

    for (const raw of batch) {
      const t = normalizeTeamFromSite(raw);
      byId.set(String(t.id), t);
    }

    if (batch.length < limit) break;
    offset += limit;
    await sleep(200);
  }

  return Array.from(byId.values()).sort((a, b) => Number(a.id) - Number(b.id));
}

async function main() {
  let teams: EspnTeam[] = [];
  try {
    teams = await fetchViaCore();
  } catch (e) {
    console.error("CORE fetch failed, falling back to SITE api…");
    console.error(e);
    teams = await fetchViaSiteFallback();
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        fetchedAtISO: new Date().toISOString(),
        count: teams.length,
        teams,
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`✅ Wrote espnTeams.json to: ${OUT}`);
  console.log(`Total unique teams: ${teams.length}`);
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
