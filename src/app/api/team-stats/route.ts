import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadTeams } from "@/data/teams";

type TeamForm = {
  teamId: string;
  teamName: string;

  season: {
    games: number;
    tempo: number; // avg possessions
    off: number; // season avg
    def: number; // season avg
  };

  last5: { w: number; l: number };
  last10: { w: number; l: number };
};

type Row = {
  date: string; // c0
  team: string; // c2
  opp: string; // c4
  site: string; // c5 (H/A/N)
  result: string; // c6 "W, 96-62"
  off: number; // c7
  def: number; // c8
  tempo: number; // c23 possessions
};

/**
 * Minimal CSV parser for one line:
 * - supports quoted fields with commas
 * - supports double quotes inside quotes ("")
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur.trim());
  return out;
}

/**
 * Use ONE normalization for both:
 * - team names from CSV
 * - team names / aliases you generate
 */
function normTeamName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "") // apostrophes
    .replace(/\./g, "") // periods
    .replace(/\buniv\b/g, "university")
    .replace(/\bst\b/g, "state") // "St" -> "state"
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTrankDataCsv(): Row[] {
  const filePath = path.join(process.cwd(), "src", "data", "Trank Data.csv");
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter(Boolean);

  // If your file includes a header row, skip it automatically:
  const startIdx = lines[0].toLowerCase().includes("date") ? 1 : 0;

  const rows: Row[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);

    // Expect at least up to c23
    if (cols.length < 24) continue;

    const date = cols[0];
    const team = cols[2];
    const opp = cols[4];
    const site = cols[5];
    const result = cols[6];
    const off = Number(cols[7]);
    const def = Number(cols[8]);
    const tempo = Number(cols[23]);

    if (!team || !date) continue;

    rows.push({
      date,
      team,
      opp,
      site,
      result,
      off: Number.isFinite(off) ? off : 0,
      def: Number.isFinite(def) ? def : 0,
      tempo: Number.isFinite(tempo) ? tempo : 0,
    });
  }

  return rows;
}

function isWin(result: string) {
  return result.trim().startsWith("W");
}

function parseMMDDYY(date: string): number {
  const [m, d, yy] = date.split("/").map((x) => Number(x));
  if (!m || !d || yy === undefined) return 0;
  const y = yy < 100 ? 2000 + yy : yy;
  return y * 10000 + m * 100 + d;
}

function avg(nums: number[]) {
  const v = nums.filter((n) => Number.isFinite(n) && n !== 0);
  if (!v.length) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * Generate a SET of normalized candidate names for matching CSV rows.
 * This fixes your "Miami FL" -> "Miami (FL)" style issues,
 * plus "McNeese St." -> "McNeese State", etc.
 */
function getNameCandidates(teamId: string, teamName: string): Set<string> {
  const raw = new Set<string>();

  // Base inputs
  raw.add(teamName);
  raw.add(teamId);

  // Basic variants
  raw.add(teamName.replace(/\bSt\./g, "State"));
  raw.add(teamName.replace(/\bSt\b/g, "State"));

  // "Miami FL" -> "Miami (FL)"
  // Also helps if your source uses state abbreviations at end.
  for (const s of [teamName, teamId]) {
    const m = s.match(/^(.+?)\s+([A-Z]{2})$/);
    if (m) raw.add(`${m[1]} (${m[2]})`);
  }

  // Common ESPN-ish / public data aliases (add more as needed)
  // These are RAW forms; we normalize them below.
  const lower = teamName.toLowerCase();
  if (lower === "connecticut") raw.add("UConn");
  if (lower === "mississippi") raw.add("Ole Miss");
  if (
    lower === "miami fl" ||
    lower === "miami (fl)" ||
    lower === "miami florida"
  ) {
    raw.add("Miami (FL)");
    raw.add("Miami Fla");
    raw.add("Miami Florida");
  }

  // Normalize + return
  const out = new Set<string>();
  for (const s of raw) out.add(normTeamName(s));
  return out;
}

export async function GET(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get("teamId");
  if (!teamId) {
    return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  }

  const teams = loadTeams();
  const team = teams.get(teamId);
  if (!team) {
    return NextResponse.json(
      { error: `Unknown teamId ${teamId}` },
      { status: 404 }
    );
  }

  const all = parseTrankDataCsv();

  // Build normalized candidate set ONCE
  const candidates = getNameCandidates(teamId, team.name);

  const games = all
    .filter((r) => candidates.has(normTeamName(r.team)))
    .sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date)); // newest first

  const l5 = games.slice(0, 5);
  const l10 = games.slice(0, 10);

  const last5 = {
    w: l5.filter((g) => isWin(g.result)).length,
    l: l5.filter((g) => !isWin(g.result)).length,
  };

  const last10 = {
    w: l10.filter((g) => isWin(g.result)).length,
    l: l10.filter((g) => !isWin(g.result)).length,
  };

  const body: TeamForm = {
    teamId,
    teamName: team.name,
    season: {
      games: games.length,
      tempo: avg(games.map((g) => g.tempo)),
      off: avg(games.map((g) => g.off)),
      def: avg(games.map((g) => g.def)),
    },
    last5,
    last10,
  };

  return NextResponse.json(body);
}
