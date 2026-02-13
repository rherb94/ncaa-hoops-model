// src/data/teamAliases.ts
import fs from "node:fs";
import path from "node:path";

type Parsed = { header: string[]; rows: string[][] };

function parseCsv(filePath: string): Parsed {
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return { header: [], rows: [] };

  // handle CRLF + blank lines
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((l) => l.split(",").map((s) => s.trim()));
  return { header, rows };
}

// Turn "Duke Blue Devils" / "St. John's" into a stable id-ish slug
function toSlugId(s: string): string {
  return (
    "team-" +
    s
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/['’.]/g, "") // remove apostrophes/periods
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/['’.]/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
}

function expandAbbreviations(name: string): string[] {
  const raw = name.trim();
  if (!raw) return [];

  const cands = new Set<string>();
  cands.add(raw);

  // common short forms from books/providers
  // St / St. => State
  cands.add(raw.replace(/\bSt\.\b/g, "State"));
  cands.add(raw.replace(/\bSt\b/g, "State"));

  // directional abbreviations
  // "N Colorado" => "Northern Colorado"
  cands.add(raw.replace(/\bN\b/g, "North"));
  cands.add(raw.replace(/\bS\b/g, "South"));
  cands.add(raw.replace(/\bE\b/g, "East"));
  cands.add(raw.replace(/\bW\b/g, "West"));

  cands.add(raw.replace(/\bNE\b/g, "Northeast"));
  cands.add(raw.replace(/\bNW\b/g, "Northwest"));
  cands.add(raw.replace(/\bSE\b/g, "Southeast"));
  cands.add(raw.replace(/\bSW\b/g, "Southwest"));

  // "N Colorado" specifically tends to mean Northern
  cands.add(raw.replace(/\bN\s+Colorado\b/i, "Northern Colorado"));

  // "CSU" -> "Cal State" (common for Bakersfield/Fullerton)
  cands.add(raw.replace(/\bCSU\b/g, "Cal State"));
  cands.add(raw.replace(/\bCSU\b/g, "California State"));

  // hyphen variants
  cands.add(raw.replace(/-/g, " "));
  cands.add(raw.replace(/\s*-\s*/g, " "));

  return Array.from(cands);
}

let cachedExact: Map<string, string> | null = null;
let cachedSlug: Map<string, string> | null = null;
let cachedNorm: Map<string, string> | null = null;

/**
 * Loads aliases from either:
 *  - src/data/teamAliases.csv   (teamId, alias)
 *  - src/data/team_aliases.csv  (aliasId/aliasTeamId, canonicalId/teamId)
 *
 * Builds 3 lookup maps:
 *  - exact: alias text -> canonical teamId
 *  - slug:  team-<slug(alias)> -> canonical teamId
 *  - norm:  normalizeKey(alias) -> canonical teamId
 */
export function loadTeamAliases(): {
  exact: Map<string, string>;
  slug: Map<string, string>;
  norm: Map<string, string>;
} {
  if (cachedExact && cachedSlug && cachedNorm) {
    return { exact: cachedExact, slug: cachedSlug, norm: cachedNorm };
  }

  const p1 = path.join(process.cwd(), "src", "data", "teamAliases.csv");
  const p2 = path.join(process.cwd(), "src", "data", "team_aliases.csv");

  const filePath = fs.existsSync(p1) ? p1 : fs.existsSync(p2) ? p2 : null;
  const exact = new Map<string, string>();
  const slug = new Map<string, string>();
  const norm = new Map<string, string>();

  if (!filePath) {
    cachedExact = exact;
    cachedSlug = slug;
    cachedNorm = norm;
    return { exact, slug, norm };
  }

  const { header, rows } = parseCsv(filePath);

  // Schema A: teamAliases.csv => (teamId, alias)
  const iTeamId = header.indexOf("teamId");
  const iAliasText = header.indexOf("alias");

  // Schema B: team_aliases.csv => (aliasId/aliasTeamId, canonicalId/teamId)
  const iAliasId =
    header.indexOf("aliasId") >= 0
      ? header.indexOf("aliasId")
      : header.indexOf("aliasTeamId");
  const iCanonical =
    header.indexOf("canonicalId") >= 0
      ? header.indexOf("canonicalId")
      : header.indexOf("teamId");

  const isSchemaA = iTeamId >= 0 && iAliasText >= 0;
  const isSchemaB = iAliasId >= 0 && iCanonical >= 0;

  if (!isSchemaA && !isSchemaB) {
    throw new Error(
      `Alias CSV missing required columns. Found: ${header.join(", ")}`
    );
  }

  const put = (aliasText: string, canonicalId: string) => {
    const a = aliasText.trim();
    const c = canonicalId.trim();
    if (!a || !c) return;

    exact.set(a, c);
    slug.set(toSlugId(a), c);
    norm.set(normalizeKey(a), c);
  };

  for (const r of rows) {
    if (isSchemaA) {
      const canonical = (r[iTeamId] ?? "").trim();
      const aliasText = (r[iAliasText] ?? "").trim();
      if (!canonical || !aliasText) continue;
      put(aliasText, canonical);
      continue;
    }

    // Schema B
    const aliasId = (r[iAliasId] ?? "").trim();
    const canonical = (r[iCanonical] ?? "").trim();
    if (!aliasId || !canonical) continue;

    put(aliasId, canonical);
  }

  cachedExact = exact;
  cachedSlug = slug;
  cachedNorm = norm;
  return { exact, slug, norm };
}

type ResolveInput = string | { provider: string; teamName: string };

export function resolveTeamId(input: ResolveInput): string | undefined {
  const teamName = typeof input === "string" ? input : input.teamName;
  return resolveTeamIdFromName(teamName);
}

function resolveTeamIdFromName(teamName: string): string | undefined {
  const raw = (teamName ?? "").trim();
  if (!raw) return undefined;

  const { exact, slug, norm } = loadTeamAliases();

  const tryResolve = (s: string): string | undefined => {
    const direct = exact.get(s);
    if (direct) return direct;

    const bySlug = slug.get(toSlugId(s));
    if (bySlug) return bySlug;

    const byNorm = norm.get(normalizeKey(s));
    if (byNorm) return byNorm;

    return undefined;
  };

  // 1) direct + abbreviation expansions
  for (const cand of expandAbbreviations(raw)) {
    const hit = tryResolve(cand);
    if (hit) return hit;
  }

  // 2) mascot-strip fallback:
  // "SE Missouri St Redhawks" -> try "SE Missouri St", etc.
  const parts = raw.split(/\s+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const candidate = parts.slice(0, i).join(" ");
    for (const cand of expandAbbreviations(candidate)) {
      const hit = tryResolve(cand);
      if (hit) return hit;
    }
  }

  return undefined;
}
