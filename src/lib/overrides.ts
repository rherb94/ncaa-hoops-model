import fs from "node:fs";
import path from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export type GameOverrides = {
  forceHome: boolean; // neutral → home (apply HCA)
  skip: boolean; // exclude from picks + results
  reason?: string;
};

type OverridesFile = {
  neutralToHome?: Record<string, Record<string, { reason?: string }>>;
  skipGame?: Record<string, Record<string, { reason?: string }>>;
};

// ── Loader ───────────────────────────────────────────────────────────────────

const cache = new Map<string, OverridesFile>();

function loadOverridesFile(leagueId: string): OverridesFile {
  if (cache.has(leagueId) && process.env.NODE_ENV === "production") {
    return cache.get(leagueId)!;
  }
  const p = path.join(process.cwd(), "src", "data", leagueId, "overrides.json");
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as OverridesFile;
    cache.set(leagueId, data);
    return data;
  } catch {
    return {};
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getGameOverrides(
  leagueId: string,
  date: string,
  gameId: string,
): GameOverrides {
  const file = loadOverridesFile(leagueId);
  const forceHome = !!file.neutralToHome?.[date]?.[gameId];
  const skip = !!file.skipGame?.[date]?.[gameId];
  const reason =
    file.neutralToHome?.[date]?.[gameId]?.reason ??
    file.skipGame?.[date]?.[gameId]?.reason;
  return { forceHome, skip, reason };
}
