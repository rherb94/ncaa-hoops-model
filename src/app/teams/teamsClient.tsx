// src/app/teams/teamsClient.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type Team = {
  teamId: string;
  name: string;
  conference?: string;
  powerRating: number;
  hca?: number;

  // ✅ from /api/teams enrichment
  logo?: string;
  espnTeamId?: string;
  espnName?: string;
  espnMatchNote?: string;
};

async function fetchTeams(): Promise<Team[]> {
  const res = await fetch("/api/teams", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load teams");
  const data = await res.json();
  return data.teams as Team[];
}

type SortKey = "powerRating" | "hca" | "name";
type SortDir = "asc" | "desc";

function cmp(a: number, b: number) {
  return a === b ? 0 : a > b ? 1 : -1;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="ml-1 inline-block text-[10px] opacity-70">
      {!active ? "↕" : dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function fmtMaybe(n: number | undefined, digits = 1) {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export default function TeamsClient() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  // search by team name only (keep conference filtering separate)
  const [q, setQ] = useState("");

  // conference filter
  const [conf, setConf] = useState<string>("ALL");

  // sorting
  const [sortKey, setSortKey] = useState<SortKey>("powerRating");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    (async () => {
      try {
        setTeams(await fetchTeams());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const conferences = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) {
      const c = (t.conference ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [teams]);

  const filteredSorted = useMemo(() => {
    const query = q.trim().toLowerCase();

    let list = teams;

    if (conf !== "ALL") {
      list = list.filter((t) => (t.conference ?? "").trim() === conf);
    }

    if (query) {
      list = list.filter((t) => t.name.toLowerCase().includes(query));
    }

    const dir = sortDir === "asc" ? 1 : -1;

    const getHca = (t: Team) =>
      Number.isFinite(t.hca) ? (t.hca as number) : -Infinity;

    const sorted = [...list].sort((a, b) => {
      if (sortKey === "name") {
        return dir * a.name.localeCompare(b.name);
      }

      if (sortKey === "powerRating") {
        const r = cmp(a.powerRating, b.powerRating) * dir;
        if (r !== 0) return r;
        return a.name.localeCompare(b.name);
      }

      // hca: treat missing as very low so they sink when sorting desc
      const ah = getHca(a);
      const bh = getHca(b);
      const r = cmp(ah, bh) * dir;
      if (r !== 0) return r;
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [teams, q, conf, sortKey, sortDir]);

  // rank number (based on current sort + filters)
  const ranked = useMemo(() => {
    return filteredSorted.map((t, idx) => ({
      ...t,
      rank: idx + 1,
    }));
  }, [filteredSorted]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      // sensible defaults
      setSortDir(nextKey === "name" ? "asc" : "desc");
    }
  }

  const thBtn =
    "inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-black/5 dark:hover:bg-zinc-900/60";

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-sm text-zinc-500">
            Loaded from <span className="mono">src/data/teams.csv</span>
            <span className="mx-2">•</span>
            Logos from <span className="mono">src/data/espnTeams.json</span>
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={conf}
            onChange={(e) => setConf(e.target.value)}
            className="h-10 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 sm:w-56"
            aria-label="Conference filter"
          >
            <option value="ALL">All conferences</option>
            {conferences.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search team…"
            className="h-10 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 sm:w-64"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[color:var(--border)] p-6 text-zinc-500">
          Loading teams…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[color:var(--muted)]">
              <tr className="text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className={thBtn}
                    title="Sort by Team"
                  >
                    Team
                    <SortIcon active={sortKey === "name"} dir={sortDir} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">Conference</th>
                <th className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("powerRating")}
                    className={thBtn}
                    title="Sort by Power Rating"
                  >
                    PR
                    <SortIcon
                      active={sortKey === "powerRating"}
                      dir={sortDir}
                    />
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("hca")}
                    className={thBtn}
                    title="Sort by Home Court Advantage"
                  >
                    HCA
                    <SortIcon active={sortKey === "hca"} dir={sortDir} />
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              {ranked.map((t) => (
                <tr
                  key={t.teamId}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-3 py-2 text-zinc-500 tabular-nums">
                    {t.rank}
                  </td>

                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-2">
                      {t.logo ? (
                        <img
                          src={t.logo}
                          alt={`${t.name} logo`}
                          className="h-6 w-6 rounded-sm"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-sm bg-zinc-950/10" />
                      )}
                      <span>{t.name}</span>
                    </div>
                  </td>

                  <td className="px-3 py-2">{t.conference ?? "—"}</td>

                  <td className="px-3 py-2 text-right mono tabular-nums">
                    {t.powerRating.toFixed(1)}
                  </td>

                  <td className="px-3 py-2 text-right mono tabular-nums">
                    {fmtMaybe(t.hca, 1)}
                  </td>
                </tr>
              ))}

              {ranked.length === 0 && (
                <tr>
                  <td
                    className="px-3 py-6 text-center text-zinc-500"
                    colSpan={5}
                  >
                    No teams match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
