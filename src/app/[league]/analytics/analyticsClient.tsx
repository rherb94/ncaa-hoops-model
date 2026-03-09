"use client";

import { useEffect, useState } from "react";
import type { LeagueId } from "@/lib/leagues";

// ---- types from API response -----------------------------------------------

type SpreadRow = {
  key: string;
  label: string;
  range: string;
  games: number;
  wins: number;
  losses: number;
  pushes: number;
  win_pct: number | null;
  avg_clv: number | null;
  avg_edge: number | null;
};

type TeamRow = {
  team_name: string;
  torvik_id: string | null;
  conference: string | null;
  logo?: string | null;
  appearances: number;
  pick_for: number;
  wins: number;
  losses: number;
  pushes: number;
  win_pct: number | null;
  avg_edge: number | null;
  avg_clv: number | null;
};

type ConfRow = {
  conference: string;
  pick_games: number;
  wins: number;
  losses: number;
  win_pct: number | null;
  avg_model_error: number | null;
};

type SideRow = {
  key: "home" | "away" | "neutral";
  label: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  win_pct: number | null;
  avg_edge: number | null;
  avg_clv: number | null;
};

type AnalyticsResponse = {
  league: string;
  dates_analyzed: number;
  date_range: { from: string; to: string };
  backfilled_included: boolean;
  by_spread: SpreadRow[];
  by_side: SideRow[];
  by_team: TeamRow[];
  by_conference: ConfRow[];
};

// ---- sort helpers -----------------------------------------------------------

type TeamSortKey = "pick_for" | "appearances" | "win_pct" | "avg_edge" | "avg_clv";
type ConfSortKey = "pick_games" | "win_pct" | "avg_model_error";

function sortTeams(rows: TeamRow[], key: TeamSortKey, dir: 1 | -1): TeamRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? -Infinity;
    const bv = b[key] ?? -Infinity;
    return (bv - av) * dir;
  });
}

function sortConf(rows: ConfRow[], key: ConfSortKey, dir: 1 | -1): ConfRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? -Infinity;
    const bv = b[key] ?? -Infinity;
    return (bv - av) * dir;
  });
}

// ---- UI helpers ------------------------------------------------------------

function WinPctCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-zinc-600">—</span>;
  const color =
    pct >= 56 ? "text-emerald-400" :
    pct >= 53 ? "text-amber-400"   :
    pct <= 44 ? "text-red-400"     :
                "text-zinc-300";
  return <span className={`font-semibold ${color}`}>{pct}%</span>;
}

function ClvCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-zinc-600">—</span>;
  const color = v >= 0.5 ? "text-emerald-400" : v <= -0.5 ? "text-red-400" : "text-zinc-400";
  return (
    <span className={`font-mono text-xs ${color}`}>
      {v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)}
    </span>
  );
}

function EdgeCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-zinc-600">—</span>;
  return <span className="font-mono text-xs text-zinc-300">{v.toFixed(1)}</span>;
}

function SortHeader({
  label,
  col,
  current,
  dir,
  onClick,
  align = "right",
}: {
  label: string;
  col: string;
  current: string;
  dir: 1 | -1;
  onClick: (col: string) => void;
  align?: "left" | "right";
}) {
  const active = col === current;
  return (
    <th
      className={`px-3 py-2 text-${align} font-medium cursor-pointer select-none hover:text-zinc-200 transition-colors ${
        active ? "text-zinc-200" : "text-zinc-500"
      }`}
      onClick={() => onClick(col)}
    >
      {label}
      {active && <span className="ml-1 text-zinc-400">{dir === -1 ? "↓" : "↑"}</span>}
    </th>
  );
}

function TableSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <div className="px-4 py-2.5 bg-zinc-900 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-xs font-semibold text-zinc-300">{title}</span>
          {subtitle && <span className="text-xs text-zinc-500 ml-2">{subtitle}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ---- Spread Bias Table ------------------------------------------------------

function SpreadBiasTable({ rows }: { rows: SpreadRow[] }) {
  const hasData = rows.some((r) => r.games > 0);
  if (!hasData) {
    return (
      <TableSection title="Spread Bias" subtitle="ATS performance by pick type">
        <div className="px-4 py-6 text-xs text-zinc-600">No pick data yet.</div>
      </TableSection>
    );
  }

  const totalPicks = rows.reduce((s, r) => s + r.games, 0);
  const totalWins  = rows.reduce((s, r) => s + r.wins,  0);
  const totalLoss  = rows.reduce((s, r) => s + r.losses, 0);
  const totalDecided = totalWins + totalLoss;
  const totalWinPct = totalDecided > 0 ? Math.round((totalWins / totalDecided) * 100) : null;

  return (
    <TableSection title="Spread Bias" subtitle="ATS performance by pick type (from the picked team's perspective)">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-zinc-500">
              <th className="px-4 py-2 text-left  font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Range</th>
              <th className="px-3 py-2 text-right font-medium">Picks</th>
              <th className="px-3 py-2 text-right font-medium">W-L</th>
              <th className="px-3 py-2 text-right font-medium">Win%</th>
              <th className="px-3 py-2 text-right font-medium">Avg Edge</th>
              <th className="px-3 py-2 text-right font-medium">Avg CLV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const decided = r.wins + r.losses;
              const isFav = r.key === "big_fav" || r.key === "fav";
              const isDog = r.key === "big_dog" || r.key === "dog";
              const typeColor = isFav ? "text-blue-400" : isDog ? "text-amber-400" : "text-zinc-300";
              return (
                <tr key={r.key} className="border-b border-white/5 bg-zinc-900/30 hover:bg-zinc-900/60">
                  <td className="px-4 py-2.5">
                    <span className={`font-semibold ${typeColor}`}>{r.label}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-500">{r.range}</td>
                  <td className="px-3 py-2.5 text-right text-zinc-400">
                    {r.games > 0 ? r.games : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                    {decided > 0 ? `${r.wins}-${r.losses}` : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right"><WinPctCell pct={r.win_pct} /></td>
                  <td className="px-3 py-2.5 text-right"><EdgeCell v={r.avg_edge} /></td>
                  <td className="px-3 py-2.5 text-right"><ClvCell v={r.avg_clv} /></td>
                </tr>
              );
            })}
          </tbody>
          {totalDecided > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-zinc-900">
                <td className="px-4 py-2.5 text-zinc-400 font-semibold text-xs" colSpan={2}>Total</td>
                <td className="px-3 py-2.5 text-right text-zinc-400 font-semibold">{totalPicks}</td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-400 font-semibold">{totalWins}-{totalLoss}</td>
                <td className="px-3 py-2.5 text-right font-semibold"><WinPctCell pct={totalWinPct} /></td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </TableSection>
  );
}

// ---- Team Frequency Table ---------------------------------------------------

const ALARM_THRESHOLD = 3; // picks threshold to flag as potential overvaluation

function TeamFrequencyTable({ rows }: { rows: TeamRow[] }) {
  const [sortKey, setSortKey]   = useState<TeamSortKey>("pick_for");
  const [sortDir, setSortDir]   = useState<1 | -1>(-1);
  const [picksOnly, setPicksOnly] = useState(true);

  function handleSort(col: string) {
    const k = col as TeamSortKey;
    if (k === sortKey) setSortDir((d) => (d === -1 ? 1 : -1));
    else { setSortKey(k); setSortDir(-1); }
  }

  const filtered = picksOnly ? rows.filter((r) => r.pick_for > 0) : rows;
  const sorted   = sortTeams(filtered, sortKey, sortDir);
  const hasData  = rows.length > 0;

  if (!hasData) {
    return (
      <TableSection title="Team Frequency" subtitle="Pick distribution by team">
        <div className="px-4 py-6 text-xs text-zinc-600">No team data yet.</div>
      </TableSection>
    );
  }

  return (
    <TableSection title="Team Frequency" subtitle={`${ALARM_THRESHOLD}+ picks flagged ⚑ as potential overvaluation`}>
      <div className="overflow-x-auto">
        <div className="px-4 py-2 flex items-center gap-2 border-b border-white/5">
          <button
            onClick={() => setPicksOnly((v) => !v)}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              picksOnly
                ? "bg-zinc-700 text-zinc-100"
                : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Picks only
          </button>
          <button
            onClick={() => setPicksOnly((v) => !v)}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              !picksOnly
                ? "bg-zinc-700 text-zinc-100"
                : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            All teams
          </button>
          <span className="text-xs text-zinc-600 ml-2">{sorted.length} team{sorted.length !== 1 ? "s" : ""}</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-2 text-left font-medium text-zinc-500">Team</th>
              <SortHeader label="Apps"    col="appearances" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Picks"   col="pick_for"    current={sortKey} dir={sortDir} onClick={handleSort} />
              <th className="px-3 py-2 text-right font-medium text-zinc-500">W-L</th>
              <SortHeader label="Win%"    col="win_pct"     current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Avg Edge" col="avg_edge"   current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Avg CLV"  col="avg_clv"    current={sortKey} dir={sortDir} onClick={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const decided  = t.wins + t.losses;
              const isAlarm  = t.pick_for >= ALARM_THRESHOLD;
              return (
                <tr key={t.torvik_id ?? t.team_name} className="border-b border-white/5 bg-zinc-900/30 hover:bg-zinc-900/60">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {t.logo
                        ? <img src={t.logo} alt="" className="h-6 w-6 shrink-0 rounded-sm object-contain opacity-90" loading="lazy" />
                        : <div className="h-6 w-6 shrink-0" />
                      }
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-200 font-medium">{t.team_name}</span>
                          {isAlarm && (
                            <span
                              title={`${t.pick_for} picks — potential overvaluation`}
                              className="text-amber-400 text-[11px]"
                            >
                              ⚑
                            </span>
                          )}
                        </div>
                        {t.conference && (
                          <div className="text-zinc-600 text-[11px]">{t.conference}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-zinc-500">{t.appearances}</td>
                  <td className="px-3 py-2.5 text-right">
                    {t.pick_for > 0 ? (
                      <span className={`font-semibold ${isAlarm ? "text-amber-400" : "text-zinc-300"}`}>
                        {t.pick_for}
                      </span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                    {decided > 0 ? `${t.wins}-${t.losses}` : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right"><WinPctCell pct={t.win_pct} /></td>
                  <td className="px-3 py-2.5 text-right"><EdgeCell v={t.avg_edge} /></td>
                  <td className="px-3 py-2.5 text-right"><ClvCell v={t.avg_clv} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TableSection>
  );
}

// ---- Conference Table -------------------------------------------------------

function ConferenceTable({ rows }: { rows: ConfRow[] }) {
  const [sortKey, setSortKey] = useState<ConfSortKey>("pick_games");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  function handleSort(col: string) {
    const k = col as ConfSortKey;
    if (k === sortKey) setSortDir((d) => (d === -1 ? 1 : -1));
    else { setSortKey(k); setSortDir(-1); }
  }

  const sorted = sortConf(rows, sortKey, sortDir);

  if (rows.length === 0) {
    return (
      <TableSection title="Conference Breakdown" subtitle="Pick performance by conference">
        <div className="px-4 py-6 text-xs text-zinc-600">No conference data yet.</div>
      </TableSection>
    );
  }

  return (
    <TableSection title="Conference Breakdown" subtitle="Model performance grouped by picked team's conference">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-2 text-left font-medium text-zinc-500">Conference</th>
              <SortHeader label="Picks"       col="pick_games"       current={sortKey} dir={sortDir} onClick={handleSort} />
              <th className="px-3 py-2 text-right font-medium text-zinc-500">W-L</th>
              <SortHeader label="Win%"         col="win_pct"          current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Avg Err"      col="avg_model_error"  current={sortKey} dir={sortDir} onClick={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const decided = c.wins + c.losses;
              return (
                <tr key={c.conference} className="border-b border-white/5 bg-zinc-900/30 hover:bg-zinc-900/60">
                  <td className="px-4 py-2.5 text-zinc-200 font-medium">{c.conference}</td>
                  <td className="px-3 py-2.5 text-right text-zinc-400">{c.pick_games}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                    {decided > 0 ? `${c.wins}-${c.losses}` : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right"><WinPctCell pct={c.win_pct} /></td>
                  <td className="px-3 py-2.5 text-right">
                    {c.avg_model_error !== null ? (
                      <span className="font-mono text-zinc-400">±{c.avg_model_error.toFixed(1)}</span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TableSection>
  );
}

// ---- Home / Away / Neutral Split Table --------------------------------------

function HomeAwaySplitTable({ rows }: { rows: SideRow[] }) {
  const hasData = rows.some((r) => r.picks > 0);
  if (!hasData) return null;

  return (
    <TableSection title="Home / Away Split" subtitle="ATS record by pick direction">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-zinc-500">
              <th className="px-4 py-2 text-left  font-medium">Direction</th>
              <th className="px-3 py-2 text-right font-medium">Picks</th>
              <th className="px-3 py-2 text-right font-medium">W-L</th>
              <th className="px-3 py-2 text-right font-medium">Win%</th>
              <th className="px-3 py-2 text-right font-medium">Avg Edge</th>
              <th className="px-3 py-2 text-right font-medium">Avg CLV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const decided = r.wins + r.losses;
              const iconMap: Record<string, string> = {
                home:    "🏠",
                away:    "✈️",
                neutral: "⚪",
              };
              return (
                <tr key={r.key} className="border-b border-white/5 bg-zinc-900/30 hover:bg-zinc-900/60">
                  <td className="px-4 py-2.5">
                    <span className="text-zinc-300 font-medium">
                      {iconMap[r.key]} {r.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-zinc-400">
                    {r.picks > 0 ? r.picks : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                    {decided > 0 ? `${r.wins}-${r.losses}` : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right"><WinPctCell pct={r.win_pct} /></td>
                  <td className="px-3 py-2.5 text-right"><EdgeCell v={r.avg_edge} /></td>
                  <td className="px-3 py-2.5 text-right"><ClvCell v={r.avg_clv} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TableSection>
  );
}

// ---- Main component ---------------------------------------------------------

export default function AnalyticsClient({ league }: { league: LeagueId }) {
  const [data, setData]         = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [backfilled, setBackfilled] = useState(false);

  async function load(includeBackfilled: boolean) {
    setLoading(true);
    setErr(null);
    try {
      const qs = includeBackfilled ? "?backfilled=1" : "";
      const res = await fetch(`/api/${league}/analytics${qs}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          setData(null);
          setErr("No analytics data available yet. Run the odds opener workflow to start tracking.");
          return;
        }
        throw new Error(`API error ${res.status}`);
      }
      setData(await res.json());
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(backfilled); }, [backfilled]);

  if (loading) return <div className="text-zinc-400 text-sm py-8">Loading analytics…</div>;
  if (err)     return <div className="text-zinc-500 text-sm py-8">{err}</div>;
  if (!data)   return null;

  const { by_spread, by_side, by_team, by_conference, dates_analyzed, date_range } = data;

  // Find any alarming patterns to surface at the top
  const alarmTeams = by_team.filter((t) => t.pick_for >= ALARM_THRESHOLD);
  const dogBias = by_spread.find((r) => r.key === "big_dog" || r.key === "dog");
  const favBias = by_spread.find((r) => r.key === "big_fav" || r.key === "fav");
  const underdogPicks = by_spread
    .filter((r) => r.key === "big_dog" || r.key === "dog")
    .reduce((s, r) => s + r.games, 0);
  const favPicks = by_spread
    .filter((r) => r.key === "big_fav" || r.key === "fav")
    .reduce((s, r) => s + r.games, 0);
  const totalPicksCounted = by_spread.reduce((s, r) => s + r.games, 0);

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1">
          <div className="text-xs text-zinc-400">Model Analytics</div>
          <div className="text-sm text-zinc-500">
            {dates_analyzed} day{dates_analyzed !== 1 ? "s" : ""} · {date_range.from} → {date_range.to}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setBackfilled((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              backfilled
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30"
                : "bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {backfilled ? "Hide backfilled" : "Include backfilled"}
          </button>
          <button
            onClick={() => load(backfilled)}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* bias summary callout */}
      {totalPicksCounted > 0 && (
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-3 space-y-1.5">
          <div className="text-xs font-semibold text-zinc-400 mb-2">Bias Snapshot</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-zinc-500">
            <span>
              Underdog picks:{" "}
              <span className={`font-semibold ${underdogPicks / totalPicksCounted > 0.5 ? "text-amber-400" : "text-zinc-300"}`}>
                {underdogPicks} ({Math.round((underdogPicks / totalPicksCounted) * 100)}%)
              </span>
            </span>
            <span>
              Favorite picks:{" "}
              <span className={`font-semibold ${favPicks / totalPicksCounted > 0.5 ? "text-blue-400" : "text-zinc-300"}`}>
                {favPicks} ({Math.round((favPicks / totalPicksCounted) * 100)}%)
              </span>
            </span>
            {alarmTeams.length > 0 && (
              <span>
                High-frequency teams:{" "}
                <span className="font-semibold text-amber-400">
                  {alarmTeams.map((t) => `${t.team_name} (${t.pick_for})`).join(", ")}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* spread bias */}
      <SpreadBiasTable rows={by_spread} />

      {/* home / away split */}
      <HomeAwaySplitTable rows={by_side ?? []} />

      {/* team frequency */}
      <TeamFrequencyTable rows={by_team} />

      {/* conference breakdown */}
      <ConferenceTable rows={by_conference} />
    </div>
  );
}
