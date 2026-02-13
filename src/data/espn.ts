// src/data/espn.ts
import fs from "node:fs";
import path from "node:path";

export type EspnTeam = {
  id: string;
  displayName?: string; // "Gonzaga Bulldogs"
  shortDisplayName?: string; // "Gonzaga"
  name?: string; // often mascot: "Bulldogs"  (DO NOT index alone)
  location?: string; // "Gonzaga"             (DO NOT index alone)
  abbreviation?: string; // "GONZ"
  logo?: string;
};

export function norm(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/&/g, " and ")
      .replace(/[()]/g, "") // remove parentheses
      .replace(/['’]/g, "")
      .replace(/\./g, "")
      .replace(/\buniv\b/g, "university")
      // IMPORTANT: treat "st" as "saint" (not "state")
      .replace(/\bst\b/g, "saint")
      // cleanup
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function readEspnJson(): any {
  const filePath = path.join(process.cwd(), "src", "data", "espnTeams.json");
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

/**
 * Walk the ESPN JSON and pull out all team objects regardless of nesting shape.
 *
 * KEY FIX:
 * ESPN JSON often repeats the same team id multiple times (some entries are stubs).
 * We must MERGE/UPGRADE by id, not "first one wins".
 */
function extractTeams(root: any): EspnTeam[] {
  const byId = new Map<string, EspnTeam>();

  // function getLogo(t: any): string | undefined {
  //   if (!t || typeof t !== "object") return undefined;

  //   const id = t.id ? String(t.id) : undefined;

  //   // 1) explicit logo field
  //   if (typeof t.logo === "string" && t.logo.trim()) return t.logo.trim();

  //   // 2) logos[] - prefer rel=default (or primary), else first href
  //   if (Array.isArray(t.logos)) {
  //     const best =
  //       t.logos.find(
  //         (l: any) =>
  //           typeof l?.href === "string" &&
  //           Array.isArray(l?.rel) &&
  //           (l.rel.includes("default") || l.rel.includes("primary"))
  //       ) ?? t.logos.find((l: any) => typeof l?.href === "string");

  //     if (best?.href) return best.href;
  //   }

  //   // 3) hard fallback: ESPN CDN by team id (works even when site api omits logos)
  //   if (id) return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;

  //   return undefined;
  // }
  let __logoCalls = 0;

  function getLogo(t: any): string | undefined {
    const nm = (
      t?.displayName ??
      t?.shortDisplayName ??
      t?.location ??
      t?.teamName ??
      ""
    )
      .toString()
      .toLowerCase();

    if (nm.includes("lindenwood") || nm.includes("southern indiana")) {
      console.log("[LOGO DEBUG - TARGET]", {
        rawId: t?.id,
        idType: typeof t?.id,
        keys: Object.keys(t ?? {}),
        displayName: t?.displayName,
        shortDisplayName: t?.shortDisplayName,
        location: t?.location,
        teamName: t?.teamName,
        espnIdCandidate: t?.espnId ?? t?.espnTeamId ?? t?.team?.id,
        logo: t?.logo,
        logos0: t?.logos?.[0],
      });
    }
    if (!t || typeof t !== "object") return undefined;
    __logoCalls++;
    if (__logoCalls <= 5 || __logoCalls % 50 === 0) {
      console.log("[LOGO DEBUG] getLogo called", {
        calls: __logoCalls,
        id: t?.id ? String(t.id) : undefined,
        name:
          t?.displayName ?? t?.shortDisplayName ?? t?.location ?? t?.teamName,
      });
    }
    const id = t.id ? String(t.id) : undefined;

    const isDebugTeam = id === "88" || id === "2815";

    // 1) explicit logo field
    if (typeof t.logo === "string" && t.logo.trim()) {
      if (isDebugTeam) {
        console.log("[LOGO DEBUG] explicit logo", {
          id,
          name: t.displayName ?? t.shortDisplayName ?? t.location,
          logo: t.logo.trim(),
        });
      }
      return t.logo.trim();
    }

    // 2) logos[] - prefer rel=default/primary
    if (Array.isArray(t.logos)) {
      const best =
        t.logos.find(
          (l: any) =>
            typeof l?.href === "string" &&
            Array.isArray(l?.rel) &&
            (l.rel.includes("default") || l.rel.includes("primary"))
        ) ?? t.logos.find((l: any) => typeof l?.href === "string");

      if (best?.href) {
        if (isDebugTeam) {
          console.log("[LOGO DEBUG] logos[] href", {
            id,
            name: t.displayName ?? t.shortDisplayName ?? t.location,
            logo: best.href,
          });
        }
        return best.href;
      }
    }

    // 3) CDN fallback
    if (id) {
      const fallback = `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;

      if (isDebugTeam) {
        console.log("[LOGO DEBUG] fallback constructed", {
          id,
          name: t.displayName ?? t.shortDisplayName ?? t.location,
          logo: fallback,
        });
      }

      return fallback;
    }

    if (isDebugTeam) {
      console.log("[LOGO DEBUG] no logo + no id", t);
    }

    return undefined;
  }
  function looksLikeTeam(obj: any): boolean {
    if (!obj || typeof obj !== "object") return false;
    if (!obj.id) return false;
    return (
      obj.displayName ||
      obj.shortDisplayName ||
      obj.name ||
      obj.location ||
      obj.abbreviation ||
      obj.logo ||
      obj.logos
    );
  }

  function scoreTeam(t: EspnTeam): number {
    // Higher = better / more complete
    let s = 0;
    if (t.displayName) s += 5;
    if (t.shortDisplayName) s += 4;
    if (t.location) s += 3;
    if (t.abbreviation) s += 2;
    if (t.logo) s += 2;
    if (t.name) s += 1;
    return s;
  }

  function upsertTeam(rawTeam: any) {
    if (!rawTeam || typeof rawTeam !== "object" || !rawTeam.id) return;

    const id = String(rawTeam.id);

    const incoming: EspnTeam = {
      id,
      displayName: rawTeam.displayName,
      shortDisplayName: rawTeam.shortDisplayName,
      name: rawTeam.name,
      location: rawTeam.location,
      abbreviation: rawTeam.abbreviation,
      logo: getLogo(rawTeam),
    };

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, incoming);
      return;
    }

    // Merge: fill missing fields, and prefer the more complete record overall.
    const merged: EspnTeam = {
      id,
      displayName: existing.displayName ?? incoming.displayName,
      shortDisplayName: existing.shortDisplayName ?? incoming.shortDisplayName,
      name: existing.name ?? incoming.name,
      location: existing.location ?? incoming.location,
      abbreviation: existing.abbreviation ?? incoming.abbreviation,
      logo: existing.logo ?? incoming.logo,
    };

    // If the incoming record is materially "better", allow it to replace some fields.
    // This helps when the first seen was a stub but later we see the full team.
    if (scoreTeam(incoming) > scoreTeam(existing)) {
      byId.set(id, {
        id,
        displayName: incoming.displayName ?? merged.displayName,
        shortDisplayName: incoming.shortDisplayName ?? merged.shortDisplayName,
        name: incoming.name ?? merged.name,
        location: incoming.location ?? merged.location,
        abbreviation: incoming.abbreviation ?? merged.abbreviation,
        logo: incoming.logo ?? merged.logo,
      });
    } else {
      byId.set(id, merged);
    }
  }

  function visit(node: any) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }

    if (node.team && typeof node.team === "object" && node.team.id) {
      upsertTeam(node.team);
    }

    if (looksLikeTeam(node)) {
      upsertTeam(node);
    }

    for (const k of Object.keys(node)) {
      visit(node[k]);
    }
  }

  visit(root);
  return [...byId.values()];
}

let cached: {
  byName: Map<string, EspnTeam>;
  byId: Map<string, EspnTeam>;
} | null = null;

export function loadEspnTeamsIndex(): {
  byName: Map<string, EspnTeam>;
  byId: Map<string, EspnTeam>;
} {
  if (cached) return cached;

  const root = readEspnJson();
  const teams = root ? extractTeams(root) : [];

  const byName = new Map<string, EspnTeam>();
  const byId = new Map<string, EspnTeam>();

  const addKey = (k: string | undefined, t: EspnTeam) => {
    if (!k) return;
    const nk = norm(k);
    if (!nk) return;
    // first write wins (stable). If you want “best wins”, do it here later.
    if (!byName.has(nk)) byName.set(nk, t);
  };

  for (const t of teams) {
    byId.set(t.id, t);

    addKey(t.displayName, t);
    addKey(t.shortDisplayName, t);
    // addKey(t.name, t);           // DO NOT index mascot-only
    addKey(t.location, t);
    addKey(t.abbreviation, t);

    if (t.location && t.name) addKey(`${t.location} ${t.name}`, t);
  }

  console.log(
    "ESPN index built:",
    byName.size,
    "name keys,",
    byId.size,
    "ids (scoped-safe)"
  );

  cached = { byName, byId };
  return cached;
}
