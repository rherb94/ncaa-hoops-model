type CanonicalTeam = {
  id: string;
  name: string; // canonical full name
  shortName?: string; // optional
  aliases?: string[]; // optional
};

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const QUALIFIERS: Array<{
  whenIncludesAny: string[];
  mustAlsoAppearAny: string[];
}> = [
  {
    whenIncludesAny: ["international", "fiu"],
    mustAlsoAppearAny: ["international", "fiu"],
  },
  { whenIncludesAny: ["upstate"], mustAlsoAppearAny: ["upstate"] },
  { whenIncludesAny: ["omaha"], mustAlsoAppearAny: ["omaha"] },
  {
    whenIncludesAny: ["corpus", "christi"],
    mustAlsoAppearAny: ["corpus", "christi"],
  },
  {
    whenIncludesAny: ["rio", "grande", "valley", "utrgv"],
    mustAlsoAppearAny: ["rio", "grande", "valley", "utrgv"],
  },
  { whenIncludesAny: ["queens"], mustAlsoAppearAny: ["queens"] },
  { whenIncludesAny: ["chicago"], mustAlsoAppearAny: ["chicago"] },
  { whenIncludesAny: ["baptist"], mustAlsoAppearAny: ["baptist"] },
];

function qualifierMismatch(inputName: string, canonicalName: string): boolean {
  const t = norm(inputName);
  const c = norm(canonicalName);

  for (const rule of QUALIFIERS) {
    const triggered = rule.whenIncludesAny.some((w) => t.includes(w));
    if (!triggered) continue;

    const ok = rule.mustAlsoAppearAny.some((w) => c.includes(w));
    if (!ok) return true;
  }
  return false;
}

function scoreMatch(input: string, candidate: string): number {
  const a = norm(input);
  const b = norm(candidate);
  if (a === b) return 100;
  if (b === a) return 100;
  if (b.startsWith(a)) return 80;
  if (b.includes(a)) return 60;

  // token overlap
  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  let overlap = 0;
  for (const t of at) if (bt.has(t)) overlap++;
  return overlap * 10;
}

export function resolveTeamId(opts: {
  inputName: string;
  teams: CanonicalTeam[];
}):
  | { ok: true; teamId: string; matchedName: string }
  | { ok: false; reason: string } {
  const { inputName, teams } = opts;

  const inputN = norm(inputName);
  if (!inputN) return { ok: false, reason: "empty-input" };

  let best: { team: CanonicalTeam; matchedName: string; score: number } | null =
    null;

  for (const t of teams) {
    const names = [t.name, t.shortName ?? "", ...(t.aliases ?? [])].filter(
      Boolean
    );

    for (const n of names) {
      if (qualifierMismatch(inputName, n)) continue;

      const s = scoreMatch(inputName, n);
      if (s <= 0) continue;

      if (!best || s > best.score) {
        best = { team: t, matchedName: n, score: s };
      }
    }
  }

  if (!best) return { ok: false, reason: "no-safe-match" };

  // OPTIONAL: require a minimum confidence to avoid wrong matches
  if (best.score < 60)
    return { ok: false, reason: `low-confidence:${best.score}` };

  return { ok: true, teamId: best.team.id, matchedName: best.matchedName };
}
