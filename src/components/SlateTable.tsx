"use client";

import React, { Fragment, useMemo, useState } from "react";
import type { SlateGame } from "@/lib/types";

type TeamStats = {
  teamId: string;
  teamName: string;
  conference?: string | null;
  record?: string | null;
  powerRating?: number | null;
  powerRank?: number | null;
  barthag?: number | null;
  adjOff?: number | null;
  adjDef?: number | null;
  tempo?: number | null;
  ranks?: {
    adjOff?: number | null;
    adjDef?: number | null;
    barthag?: number | null;
    tempo?: number | null;
  };
};

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtNum(n: number | undefined | null, digits = 1) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

function fmtInt(n: number | undefined | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return String(Math.trunc(n));
}

function fmtPct(n: number | undefined | null, digits = 1) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${(Number(n) * 100).toFixed(digits)}%`;
}

// Edge with explicit +/- sign and color
function EdgeCell({ edge }: { edge?: number | null }) {
  if (edge === undefined || edge === null || Number.isNaN(edge))
    return <span className="text-zinc-500">—</span>;

  const a = Math.abs(edge);
  const color =
    a >= 8 ? (edge > 0 ? "text-emerald-200" : "text-rose-200") :
    a >= 5 ? (edge > 0 ? "text-emerald-300/90" : "text-rose-300/90") :
    a >= 3 ? (edge > 0 ? "text-emerald-300/70" : "text-rose-300/70") :
    "text-zinc-400";

  const label = edge > 0 ? `+${fmtNum(edge)}` : fmtNum(edge);
  return <span className={`font-semibold tabular-nums ${color}`}>{label}</span>;
}

function modelSpreadClass(modelSpread?: number | null) {
  if (modelSpread === undefined || modelSpread === null || Number.isNaN(modelSpread))
    return "text-zinc-400";
  return modelSpread < 0 ? "text-rose-200" : "text-emerald-200";
}

function signalPillClass(signal?: SlateGame["model"]["signal"]) {
  switch (signal) {
    case "STRONG":
      return "border-emerald-300/50 bg-emerald-500/15 text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]";
    case "LEAN":
      return "border-yellow-300/50 bg-yellow-400/10 text-yellow-50 shadow-[0_0_0_1px_rgba(250,204,21,0.10)]";
    default:
      return "border-white/10 bg-zinc-900/60 text-zinc-400";
  }
}

function rowTint(signal?: SlateGame["model"]["signal"]) {
  if (signal === "STRONG") return "bg-emerald-500/10";
  if (signal === "LEAN") return "bg-yellow-400/10";
  return "bg-transparent";
}

function railClass(signal?: SlateGame["model"]["signal"]) {
  if (signal === "STRONG") return "border-l-4 border-emerald-300/70";
  if (signal === "LEAN") return "border-l-4 border-yellow-300/70";
  return "border-l-4 border-transparent";
}

function bookLogoSrc(book?: string | null) {
  if (!book) return null;
  const k = String(book).toLowerCase().trim();
  if (k.includes("draft")) return "/logos/books/draftkings.png";
  if (k.includes("fan")) return "/logos/books/fanduel.png";
  if (k.includes("mgm")) return "/logos/books/betmgm.png";
  return null;
}

// Combined pick + best line cell: shows "AWAY  -8.5  [DK logo]"
function PickCell({
  side,
  line,
  book,
}: {
  side?: "HOME" | "AWAY" | "NONE";
  line?: number | null;
  book?: string | null;
}) {
  if (!side || side === "NONE") return <span className="text-zinc-600">—</span>;

  const sideColor = side === "AWAY"
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-400/30"
    : "text-rose-300 bg-rose-500/10 border-rose-400/30";

  // line is always stored in home-spread convention; negate for AWAY picks
  const displayLine = line != null && side === "AWAY" ? -line : line;
  const lineStr = displayLine != null && !Number.isNaN(displayLine)
    ? (displayLine > 0 ? `+${fmtNum(displayLine)}` : fmtNum(displayLine))
    : null;

  const logoSrc = bookLogoSrc(book);

  return (
    <div className="flex items-center gap-1.5">
      <span className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${sideColor}`}>
        {side}
      </span>
      {lineStr && (
        <span className="tabular-nums text-xs text-zinc-200 font-medium">{lineStr}</span>
      )}
      {logoSrc && (
        <img
          src={logoSrc}
          alt={book ?? ""}
          className="h-5 w-5 rounded object-contain opacity-80"
          loading="lazy"
          title={book ?? ""}
        />
      )}
    </div>
  );
}

function TeamCell({ name, logo }: { name: string; logo?: string | null }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-6 w-6 shrink-0 rounded-sm object-contain opacity-95"
          loading="lazy"
        />
      ) : (
        <div className="h-6 w-6 shrink-0 rounded-sm bg-zinc-800" />
      )}
      <span className="font-medium text-zinc-100 truncate">{name}</span>
    </div>
  );
}

function StatRow({
  label,
  value,
  right,
}: {
  label: string;
  value: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-zinc-400">{label}</div>
      <div className="flex items-center gap-2">
        <div className="font-medium text-zinc-100 tabular-nums">{value}</div>
        {right ? <div className="text-xs text-zinc-500 tabular-nums">{right}</div> : null}
      </div>
    </div>
  );
}

function TeamExpandedCard({ title, t }: { title: string; t?: TeamStats }) {
  const conf = t?.conference ?? null;
  const record = t?.record ?? null;
  const adjMargin =
    t?.adjOff != null && t?.adjDef != null
      ? Number(t.adjOff) - Number(t.adjDef)
      : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100 truncate">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            {conf && (
              <span className="rounded-full border border-white/10 bg-zinc-900/60 px-2 py-0.5">
                {conf}
              </span>
            )}
            {record && <span>{record}</span>}
          </div>
        </div>
        <div className="text-xs text-zinc-500">{t ? "Torvik" : "Loading…"}</div>
      </div>

      {!t ? (
        <div className="text-sm text-zinc-500">Loading…</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">Rating</div>
            <div className="space-y-1.5 text-xs">
              <StatRow label="Power Rank" value={t.powerRank ? `#${t.powerRank}` : "—"} />
              <StatRow
                label="Barthag"
                value={fmtPct(t.barthag, 1)}
                right={t.ranks?.barthag ? `#${fmtInt(t.ranks.barthag)}` : undefined}
              />
              <StatRow
                label="Adj. Margin"
                value={adjMargin == null ? "—" : fmtNum(adjMargin, 1)}
              />
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">Efficiency</div>
            <div className="space-y-1.5 text-xs">
              <StatRow
                label="Adj. Off"
                value={fmtNum(t.adjOff, 1)}
                right={t.ranks?.adjOff ? `#${fmtInt(t.ranks.adjOff)}` : undefined}
              />
              <StatRow
                label="Adj. Def"
                value={fmtNum(t.adjDef, 1)}
                right={t.ranks?.adjDef ? `#${fmtInt(t.ranks.adjDef)}` : undefined}
              />
              <StatRow
                label="Tempo"
                value={fmtNum(t.tempo, 1)}
                right={t.ranks?.tempo ? `#${fmtInt(t.ranks.tempo)}` : undefined}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function fetchTeamStats(teamId: string): Promise<TeamStats> {
  const res = await fetch(`/api/team-stats?teamId=${encodeURIComponent(teamId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`team-stats failed (${res.status})`);
  return res.json();
}

type FilterMode = "ALL" | "PICKS" | "STRONG";

export default function SlateTable({ games }: { games: SlateGame[] }) {
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, TeamStats>>({});
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("ALL");
  const [compact, setCompact] = useState<boolean>(false);

  const now = Date.now();

  const upcoming = useMemo(() => {
    return (games ?? []).filter((g) => {
      const t = new Date(g.startTimeISO).getTime();
      return Number.isFinite(t) ? t > now : true;
    });
  }, [games, now]);

  const counts = useMemo(() => {
    const lean = upcoming.filter((g) => g.model.signal === "LEAN").length;
    const strong = upcoming.filter((g) => g.model.signal === "STRONG").length;
    return { games: upcoming.length, lean, strong };
  }, [upcoming]);

  const filtered = useMemo(() => {
    let arr = [...upcoming];
    if (filter === "PICKS") arr = arr.filter((g) => g.model.signal === "LEAN" || g.model.signal === "STRONG");
    else if (filter === "STRONG") arr = arr.filter((g) => g.model.signal === "STRONG");

    arr.sort((a, b) => {
      const rank = (s: SlateGame["model"]["signal"]) => s === "STRONG" ? 2 : s === "LEAN" ? 1 : 0;
      const r = rank(b.model.signal) - rank(a.model.signal);
      if (r !== 0) return r;
      const ea = Math.abs(a.model.edge ?? 0);
      const eb = Math.abs(b.model.edge ?? 0);
      if (ea !== eb) return eb - ea;
      return new Date(a.startTimeISO).getTime() - new Date(b.startTimeISO).getTime();
    });

    return arr;
  }, [upcoming, filter]);

  async function toggleRow(g: SlateGame) {
    setErr(null);
    const next = openGameId === g.gameId ? null : g.gameId;
    setOpenGameId(next);
    if (!next) return;

    const want = [g.homeTeamId, g.awayTeamId].filter((id) => !stats[id]);
    if (!want.length) return;

    try {
      const results = await Promise.all(want.map(fetchTeamStats));
      setStats((prev) => {
        const copy = { ...prev };
        for (const r of results) copy[r.teamId] = r;
        return copy;
      });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to fetch team stats");
    }
  }

  const tdBase = compact ? "px-3 py-2" : "px-3 py-3";
  const thCls = "px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-left";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20">
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Daily Slate</div>
            <div className="mt-0.5 text-xs text-zinc-400">
              Sorted by Signal → |Edge| → Time · Started games hidden
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              {counts.games} games ·{" "}
              <span className="text-yellow-200/90">{counts.lean} LEAN</span> ·{" "}
              <span className="text-emerald-200/90">{counts.strong} STRONG</span>
            </div>
            {err && <div className="mt-2 text-xs text-rose-200">{err}</div>}
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Filter toggle */}
            <div className="flex rounded-full border border-white/10 bg-zinc-900/60 p-1">
              {(["ALL", "PICKS", "STRONG"] as FilterMode[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    filter === f
                      ? "bg-white/10 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {f === "ALL" ? "All" : f === "PICKS" ? "Picks" : "Strong"}
                </button>
              ))}
            </div>

            <button
              onClick={() => setCompact((v) => !v)}
              className={`rounded-full border px-3 py-2 text-xs transition ${
                compact
                  ? "border-white/10 bg-white/10 text-zinc-100"
                  : "border-white/10 bg-zinc-900/60 text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Compact
            </button>

            {/* Legend */}
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/60 px-3 py-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                <span className="h-2 w-2 rounded-full bg-emerald-300/80" /> STRONG
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                <span className="h-2 w-2 rounded-full bg-yellow-300/80" /> LEAN
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile card list (hidden on md+) ── */}
      <div className="md:hidden divide-y divide-white/[0.06]">
        {filtered.map((g) => {
          const open = openGameId === g.gameId;
          const spreadLabel = g.consensus?.spread != null
            ? (g.consensus.spread > 0 ? `+${fmtNum(g.consensus.spread)}` : fmtNum(g.consensus.spread))
            : "—";
          return (
            <div key={g.gameId} className={`${rowTint(g.model.signal)}`}>
              {/* Card row */}
              <button
                className={`w-full text-left px-4 py-3 ${railClass(g.model.signal)}`}
                onClick={() => toggleRow(g)}
              >
                {/* Top line: time + signal */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-500">{fmtTime(g.startTimeISO)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${signalPillClass(g.model.signal)}`}>
                    {g.model.signal}
                  </span>
                </div>

                {/* Teams */}
                <div className="space-y-1 mb-2.5">
                  <div className="flex items-center gap-2">
                    {g.awayLogo
                      ? <img src={g.awayLogo} alt="" className="h-5 w-5 shrink-0 object-contain opacity-90" loading="lazy" />
                      : <div className="h-5 w-5 shrink-0 rounded-sm bg-zinc-800" />}
                    <span className="text-sm font-medium text-zinc-200 truncate">{g.awayTeam}</span>
                    <span className="ml-auto text-xs tabular-nums text-zinc-400">
                      {g.consensus?.moneylineAway != null ? fmtInt(g.consensus.moneylineAway) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {g.homeLogo
                      ? <img src={g.homeLogo} alt="" className="h-5 w-5 shrink-0 object-contain opacity-90" loading="lazy" />
                      : <div className="h-5 w-5 shrink-0 rounded-sm bg-zinc-800" />}
                    <span className="text-sm font-medium text-zinc-100 truncate">{g.homeTeam}</span>
                    <span className="ml-auto text-xs tabular-nums text-zinc-400">
                      {g.consensus?.moneylineHome != null ? fmtInt(g.consensus.moneylineHome) : "—"}
                    </span>
                  </div>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-zinc-500">Sprd </span>
                    <span className="tabular-nums text-zinc-200 font-medium">{spreadLabel}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Model </span>
                    <span className={`tabular-nums font-semibold ${modelSpreadClass(g.model?.modelSpread)}`}>
                      {fmtNum(g.model?.modelSpread, 1)}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Edge </span>
                    <EdgeCell edge={g.model?.edge} />
                  </div>
                  {g.recommended?.side && g.recommended.side !== "NONE" && (
                    <div className="ml-auto">
                      <PickCell
                        side={g.recommended.side}
                        line={g.recommended.line ?? null}
                        book={g.recommended.book ?? null}
                      />
                    </div>
                  )}
                </div>
              </button>

              {/* Expanded team stats */}
              {open && (
                <div className="px-4 pb-4 bg-zinc-950/20">
                  <div className="grid gap-3">
                    <TeamExpandedCard title={g.awayTeam} t={stats[g.awayTeamId]} />
                    <TeamExpandedCard title={g.homeTeam} t={stats[g.homeTeamId]} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Desktop table (hidden below md) ── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-[1100px] w-full table-fixed text-sm" aria-label="Daily slate">
          <colgroup>
            <col className="w-[85px]" />   {/* Time */}
            <col className="w-[220px]" />  {/* Away */}
            <col className="w-[220px]" />  {/* Home */}
            <col className="w-[70px]" />   {/* Spread */}
            <col className="w-[72px]" />   {/* ML Away */}
            <col className="w-[72px]" />   {/* ML Home */}
            <col className="w-[100px]" />  {/* PR A / H */}
            <col className="w-[55px]" />   {/* HCA */}
            <col className="w-[80px]" />   {/* Model */}
            <col className="w-[70px]" />   {/* Edge */}
            <col className="w-[80px]" />   {/* Signal */}
            <col className="w-[160px]" />  {/* Pick */}
          </colgroup>

          <thead className="sticky top-0 z-10 bg-black/80 text-zinc-400 backdrop-blur border-b border-white/10">
            <tr>
              <th className={thCls}>Time</th>
              <th className={thCls}>Away</th>
              <th className={thCls}>Home</th>
              <th className={thCls}>Spread</th>
              <th className={thCls}>ML Away</th>
              <th className={thCls}>ML Home</th>
              <th className={thCls}>PR (A/H)</th>
              <th className={thCls}>HCA</th>
              <th className={thCls}>Model</th>
              <th className={thCls}>Edge</th>
              <th className={thCls}>Signal</th>
              <th className={thCls}>Pick</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.06]">
            {filtered.map((g) => {
              const open = openGameId === g.gameId;
              return (
                <Fragment key={g.gameId}>
                  <tr
                    className={`cursor-pointer transition-colors hover:bg-white/[0.03] ${rowTint(g.model.signal)}`}
                    onClick={() => toggleRow(g)}
                    title="Click to expand team details"
                  >
                    {/* Time */}
                    <td className={`${tdBase} text-zinc-400 whitespace-nowrap align-middle ${railClass(g.model.signal)}`}>
                      {fmtTime(g.startTimeISO)}
                    </td>

                    {/* Away */}
                    <td className={`${tdBase} align-middle`}>
                      <TeamCell name={g.awayTeam} logo={g.awayLogo} />
                    </td>

                    {/* Home */}
                    <td className={`${tdBase} align-middle`}>
                      <TeamCell name={g.homeTeam} logo={g.homeLogo} />
                    </td>

                    {/* Spread */}
                    <td className={`${tdBase} tabular-nums text-zinc-200`}>
                      {fmtNum(g.consensus?.spread, 1)}
                    </td>

                    {/* ML Away */}
                    <td className={`${tdBase} tabular-nums text-zinc-300`}>
                      {fmtInt(g.consensus?.moneylineAway)}
                    </td>

                    {/* ML Home */}
                    <td className={`${tdBase} tabular-nums text-zinc-300`}>
                      {fmtInt(g.consensus?.moneylineHome)}
                    </td>

                    {/* PR (A / H) — merged */}
                    <td className={`${tdBase} tabular-nums text-zinc-300`}>
                      <span className="text-zinc-400">{fmtNum(g.model?.awayPR, 1)}</span>
                      <span className="text-zinc-600 mx-1">/</span>
                      <span>{fmtNum(g.model?.homePR, 1)}</span>
                    </td>

                    {/* HCA */}
                    <td className={`${tdBase} tabular-nums text-zinc-300`}>
                      {fmtNum(g.model?.hca, 1)}
                    </td>

                    {/* Model spread */}
                    <td className={`${tdBase} font-semibold tabular-nums ${modelSpreadClass(g.model?.modelSpread)}`}>
                      {fmtNum(g.model?.modelSpread, 1)}
                    </td>

                    {/* Edge */}
                    <td className={`${tdBase}`}>
                      <EdgeCell edge={g.model?.edge} />
                    </td>

                    {/* Signal */}
                    <td className={`${tdBase}`}>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${signalPillClass(g.model.signal)}`}>
                        {g.model.signal}
                      </span>
                    </td>

                    {/* Pick — merged Rec + Best Line */}
                    <td className={`${tdBase}`}>
                      <PickCell
                        side={g.recommended?.side}
                        line={g.recommended?.line ?? null}
                        book={g.recommended?.book ?? null}
                      />
                    </td>
                  </tr>

                  {open && (
                    <tr className="bg-zinc-950/20">
                      <td colSpan={12} className="px-3 py-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <TeamExpandedCard title={g.awayTeam} t={stats[g.awayTeamId]} />
                          <TeamExpandedCard title={g.homeTeam} t={stats[g.homeTeamId]} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="px-4 py-6 text-sm text-zinc-400">
          No games match the current filter.
        </div>
      )}
    </div>
  );
}
