// src/app/[league]/teams/teamsClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueId } from "@/lib/leagues";

type Team = {
  teamId: string;
  name: string;
  conference?: string;
  powerRating: number;
  hca: number;
  logo?: string;
  espnTeamId?: string;
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

async function fetchTeams(league: LeagueId): Promise<Team[]> {
  const res = await fetch(`/api/${league}/teams`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load teams");
  const data = await res.json();
  return data.teams as Team[];
}

type SortKey = "torvikRank" | "adjO" | "adjD" | "tempo" | "barthag" | "hca" | "name" | "record";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="ml-0.5 inline-block text-[10px] opacity-70">
      {!active ? "↕" : dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function fmt(n: number | undefined | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(digits);
}

export default function TeamsClient({ league }: { league: LeagueId }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [conf, setConf] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("torvikRank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    (async () => {
      try {
        setTeams(await fetchTeams(league));
      } finally {
        setLoading(false);
      }
    })();
  }, [league]);

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
    if (conf !== "ALL") list = list.filter((t) => (t.conference ?? "").trim() === conf);
    if (query) list = list.filter((t) => t.name.toLowerCase().includes(query));

    const dir = sortDir === "asc" ? 1 : -1;

    const val = (t: Team): number => {
      switch (sortKey) {
        case "torvikRank": return t.torvikRank ?? 9999;
        case "adjO": return t.adjO ?? -Infinity;
        case "adjD": return t.adjD ?? Infinity;
        case "tempo": return t.tempo ?? -Infinity;
        case "barthag": return t.barthag ?? -Infinity;
        case "hca": return Number.isFinite(t.hca) ? t.hca : -Infinity;
        case "record": return (t.wins ?? 0) - (t.losses ?? 0);
        default: return 0;
      }
    };

    return [...list].sort((a, b) => {
      if (sortKey === "name") return dir * a.name.localeCompare(b.name);
      const r = (val(a) - val(b)) * dir;
      return r !== 0 ? r : a.name.localeCompare(b.name);
    });
  }, [teams, q, conf, sortKey, sortDir]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      // Lower is better for rank and adjD; higher is better for everything else
      setSortDir(nextKey === "name" || nextKey === "torvikRank" || nextKey === "adjD" ? "asc" : "desc");
    }
  }

  const thBtn = "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 hover:bg-zinc-900/60 cursor-pointer";

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-sm text-zinc-500">
            {teams.length} teams · Torvik ratings updated daily
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={conf}
            onChange={(e) => setConf(e.target.value)}
            className="h-10 w-full rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 sm:w-56"
            aria-label="Conference filter"
          >
            <option value="ALL">All conferences</option>
            {conferences.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search team…"
            className="h-10 w-full rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 sm:w-64"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/10 p-6 text-zinc-500">Loading teams…</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="px-3 py-2.5 text-left">
                    <button type="button" onClick={() => toggleSort("torvikRank")} className={thBtn}>
                      # <SortIcon active={sortKey === "torvikRank"} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-left">
                    <button type="button" onClick={() => toggleSort("name")} className={thBtn}>
                      Team <SortIcon active={sortKey === "name"} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Conf</th>
                  <th className="px-3 py-2.5 text-center whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("record")} className={thBtn}>
                      Record <SortIcon active={sortKey === "record"} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("adjO")} className={thBtn}>
                      AdjO <SortIcon active={sortKey === "adjO"} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("adjD")} className={thBtn}>
                      AdjD <SortIcon active={sortKey === "adjD"} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("tempo")} className={thBtn}>
                      Tempo <SortIcon active={sortKey === "tempo"} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("barthag")} className={thBtn}>
                      Barthag <SortIcon active={sortKey === "barthag"} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("hca")} className={thBtn}>
                      HCA <SortIcon active={sortKey === "hca"} dir={sortDir} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((t) => {
                  const adjEM = t.adjO != null && t.adjD != null ? t.adjO - t.adjD : null;
                  return (
                    <tr key={t.teamId} className="border-t border-white/5 hover:bg-zinc-900/40">
                      <td className="px-3 py-2 text-zinc-500 font-mono tabular-nums">
                        {t.torvikRank ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {t.logo ? (
                            <img src={t.logo} alt="" className="h-5 w-5 shrink-0 rounded-sm object-contain" loading="lazy" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="h-5 w-5 shrink-0 rounded-sm bg-zinc-800" />
                          )}
                          <span className="text-zinc-200 font-medium truncate">{t.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{t.conference ?? "—"}</td>
                      <td className="px-3 py-2 text-center font-mono tabular-nums text-zinc-400 whitespace-nowrap">
                        {t.record ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-300 whitespace-nowrap">
                        {fmt(t.adjO)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-300 whitespace-nowrap">
                        {fmt(t.adjD)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 whitespace-nowrap">
                        {fmt(t.tempo)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 whitespace-nowrap">
                        {t.barthag != null ? (t.barthag * 100).toFixed(1) + "%" : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-500 whitespace-nowrap">
                        {fmt(t.hca)}
                      </td>
                    </tr>
                  );
                })}
                {filteredSorted.length === 0 && (
                  <tr><td className="px-3 py-6 text-center text-zinc-500" colSpan={9}>No teams match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filteredSorted.map((t) => (
              <div key={t.teamId} className="rounded-xl border border-white/8 bg-zinc-950 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-zinc-600 text-xs font-mono w-6 text-right shrink-0">{t.torvikRank ?? "—"}</span>
                  {t.logo ? (
                    <img src={t.logo} alt="" className="h-5 w-5 rounded-sm object-contain" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="h-5 w-5 rounded-sm bg-zinc-800" />
                  )}
                  <span className="text-sm font-medium text-zinc-200 truncate">{t.name}</span>
                  {t.record && <span className="text-xs text-zinc-500 ml-auto shrink-0">{t.record}</span>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
                  {t.conference && <span>{t.conference}</span>}
                  <span>O <span className="text-zinc-300 font-mono">{fmt(t.adjO)}</span></span>
                  <span>D <span className="text-zinc-300 font-mono">{fmt(t.adjD)}</span></span>
                  <span>T <span className="text-zinc-400 font-mono">{fmt(t.tempo)}</span></span>
                  <span>B <span className="text-zinc-400 font-mono">{t.barthag != null ? (t.barthag * 100).toFixed(1) + "%" : "—"}</span></span>
                </div>
              </div>
            ))}
            {filteredSorted.length === 0 && (
              <div className="text-zinc-500 text-sm text-center py-6">No teams match your filters.</div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
