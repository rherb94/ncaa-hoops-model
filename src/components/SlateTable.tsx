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

function edgeClass(edge?: number) {
  if (edge === undefined || Number.isNaN(edge)) return "text-zinc-400";
  const a = Math.abs(edge);
  if (a >= 8) return edge > 0 ? "text-emerald-200" : "text-rose-200";
  if (a >= 4) return edge > 0 ? "text-emerald-300/90" : "text-rose-300/90";
  if (a >= 2) return edge > 0 ? "text-emerald-300/70" : "text-rose-300/70";
  return "text-zinc-200";
}

function modelSpreadClass(modelSpread?: number) {
  if (modelSpread === undefined || Number.isNaN(modelSpread))
    return "text-zinc-400";
  return modelSpread < 0 ? "text-rose-200" : "text-emerald-200";
}

function signalPillClass(signal?: SlateGame["model"]["signal"]) {
  switch (signal) {
    case "STRONG":
      return "border-emerald-300/50 bg-emerald-500/15 text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]";
    case "LEAN":
      // more yellow, less orange
      return "border-yellow-300/50 bg-yellow-400/10 text-yellow-50 shadow-[0_0_0_1px_rgba(250,204,21,0.10)]";
    default:
      return "border-white/10 bg-zinc-900/60 text-zinc-200";
  }
}

function recPillClass(side?: "HOME" | "AWAY" | "NONE") {
  if (side === "HOME") return "border-rose-300/50 bg-rose-500/15 text-rose-50";
  if (side === "AWAY")
    return "border-emerald-300/50 bg-emerald-500/15 text-emerald-50";
  return "border-white/10 bg-zinc-900/60 text-zinc-200";
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

// ---- Book logo helpers ----
// Put these in /public/logos/books/: fanduel.png, draftkings.png, betmgm.png
function bookLogoSrc(book?: string | null) {
  if (!book) return null;
  const k = String(book).toLowerCase().trim();
  if (k.includes("draft")) return "/logos/books/draftkings.png";
  if (k.includes("fan")) return "/logos/books/fanduel.png";
  if (k.includes("mgm")) return "/logos/books/betmgm.png";
  return null;
}

function MarketCell({ source }: { source?: string | null }) {
  const src = bookLogoSrc(source);
  return (
    <div className="flex items-center justify-center">
      {src ? (
        <img
          src={src}
          alt={source ?? ""}
          className="h-6 w-6 rounded-md object-contain opacity-95"
          loading="lazy"
        />
      ) : (
        <span className="rounded-full border border-white/10 bg-zinc-900/60 px-2 py-0.5 text-xs text-zinc-200">
          {source ?? "—"}
        </span>
      )}
    </div>
  );
}

function BestLineCell({
  line,
  book,
}: {
  line?: number | null;
  book?: string | null;
}) {
  if (line == null || Number.isNaN(line))
    return <span className="text-zinc-400">—</span>;
  const src = bookLogoSrc(book);
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-zinc-100 tabular-nums">{fmtNum(line, 1)}</span>
      {src ? (
        <img
          src={src}
          alt={book ?? ""}
          className="h-6 w-6 rounded-md object-contain opacity-95"
          loading="lazy"
          title={book ?? ""}
        />
      ) : (
        <span className="text-xs text-zinc-400">({book ?? "—"})</span>
      )}
    </div>
  );
}

async function fetchTeamStats(teamId: string): Promise<TeamStats> {
  const res = await fetch(
    `/api/team-stats?teamId=${encodeURIComponent(teamId)}`,
    {
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`team-stats failed (${res.status})`);
  return res.json();
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
        <div className="h-6 w-6 shrink-0 rounded-sm bg-zinc-900/60" />
      )}
      <div className="min-w-0 leading-tight">
        <div className="font-medium text-zinc-100 truncate">{name}</div>
      </div>
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
        {right ? (
          <div className="text-xs text-zinc-500 tabular-nums">{right}</div>
        ) : null}
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
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100 truncate">
            {title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            {conf ? (
              <span className="rounded-full border border-white/10 bg-zinc-900/60 px-2 py-0.5">
                {conf}
              </span>
            ) : null}
            {record ? <span>{record}</span> : null}
          </div>
        </div>

        <div className="text-xs text-zinc-500">{t ? "Torvik" : "Loading…"}</div>
      </div>

      {!t ? (
        <div className="text-sm text-zinc-500">Loading…</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">
              Rating
            </div>
            <div className="space-y-1.5 text-xs">
              <StatRow
                label="Power Rank"
                value={t.powerRank ? `#${t.powerRank}` : "—"}
              />
              <StatRow
                label="Barthag"
                value={fmtPct(t.barthag, 1)}
                right={
                  t.ranks?.barthag ? `#${fmtInt(t.ranks.barthag)}` : undefined
                }
              />
              <StatRow
                label="Adj. Margin (per 100)"
                value={adjMargin == null ? "—" : fmtNum(adjMargin, 1)}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">
              Efficiency
            </div>
            <div className="space-y-1.5 text-xs">
              <StatRow
                label="Adj. Off"
                value={fmtNum(t.adjOff, 1)}
                right={
                  t.ranks?.adjOff ? `#${fmtInt(t.ranks.adjOff)}` : undefined
                }
              />
              <StatRow
                label="Adj. Def"
                value={fmtNum(t.adjDef, 1)}
                right={
                  t.ranks?.adjDef ? `#${fmtInt(t.ranks.adjDef)}` : undefined
                }
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

type FilterMode = "ALL" | "PICKS" | "STRONG";

export default function SlateTable({ games }: { games: SlateGame[] }) {
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, TeamStats>>({});
  const [err, setErr] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterMode>("ALL");
  const [compact, setCompact] = useState<boolean>(false);

  const now = Date.now();

  // Hide games that have started
  const upcoming = useMemo(() => {
    return (games ?? []).filter((g) => {
      const t = new Date(g.startTimeISO).getTime();
      return Number.isFinite(t) ? t > now : true;
    });
  }, [games, now]);

  // Counts (based on visible set)
  const counts = useMemo(() => {
    const lean = upcoming.filter((g) => g.model.signal === "LEAN").length;
    const strong = upcoming.filter((g) => g.model.signal === "STRONG").length;
    return { games: upcoming.length, lean, strong };
  }, [upcoming]);

  const filtered = useMemo(() => {
    let arr = [...upcoming];

    if (filter === "PICKS") {
      arr = arr.filter(
        (g) => g.model.signal === "LEAN" || g.model.signal === "STRONG"
      );
    } else if (filter === "STRONG") {
      arr = arr.filter((g) => g.model.signal === "STRONG");
    }

    // Sort: signal → |edge| → time
    arr.sort((a, b) => {
      const rank = (s: SlateGame["model"]["signal"]) =>
        s === "STRONG" ? 2 : s === "LEAN" ? 1 : 0;
      const r = rank(b.model.signal) - rank(a.model.signal);
      if (r !== 0) return r;

      const ea = Math.abs(a.model.edge ?? 0);
      const eb = Math.abs(b.model.edge ?? 0);
      if (ea !== eb) return eb - ea;

      return (
        new Date(a.startTimeISO).getTime() - new Date(b.startTimeISO).getTime()
      );
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

  const getStats = (teamId: string) => stats[teamId];

  const thBase =
    "[&>th]:px-3 [&>th]:py-2.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide";
  const tdBase = compact ? "px-3 py-2.5" : "px-3 py-3";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20">
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-100">
              Daily Slate
            </div>
            <div className="mt-0.5 text-xs text-zinc-400">
              Sorted by Signal → |Edge| → Time • Started games hidden
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              {counts.games} games •{" "}
              <span className="text-yellow-200/90">{counts.lean} LEAN</span> •{" "}
              <span className="text-emerald-200/90">
                {counts.strong} STRONG
              </span>
            </div>
            {err ? (
              <div className="mt-2 text-xs text-rose-200">{err}</div>
            ) : null}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-white/10 bg-zinc-900/60 p-1">
              <button
                onClick={() => setFilter("ALL")}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  filter === "ALL"
                    ? "bg-white/10 text-zinc-100"
                    : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter("PICKS")}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  filter === "PICKS"
                    ? "bg-white/10 text-zinc-100"
                    : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                Picks
              </button>
              <button
                onClick={() => setFilter("STRONG")}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  filter === "STRONG"
                    ? "bg-white/10 text-zinc-100"
                    : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                Strong
              </button>
            </div>

            <button
              onClick={() => setCompact((v) => !v)}
              className={`rounded-full border px-3 py-2 text-xs transition ${
                compact
                  ? "border-white/10 bg-white/10 text-zinc-100"
                  : "border-white/10 bg-zinc-900/60 text-zinc-200 hover:bg-white/5"
              }`}
            >
              Compact
            </button>

            {/* Legend pills */}
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/60 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-xs text-zinc-200">
                <span className="h-2 w-2 rounded-full bg-emerald-300/80" />
                STRONG
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-zinc-200">
                <span className="h-2 w-2 rounded-full bg-yellow-300/80" />
                LEAN
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-[1400px] w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[90px]" />
            <col className="w-[280px]" />
            <col className="w-[280px]" />
            <col className="w-[70px]" />
            <col className="w-[70px]" />
            <col className="w-[80px]" />
            <col className="w-[80px]" />
            <col className="w-[95px]" />
            <col className="w-[80px]" />
            <col className="w-[80px]" />
            <col className="w-[60px]" />
            <col className="w-[90px]" />
            <col className="w-[70px]" />
            <col className="w-[80px]" />
            <col className="w-[70px]" />
            <col className="w-[140px]" />
          </colgroup>

          <thead className="sticky top-0 z-10 bg-black/80 text-left text-zinc-200 backdrop-blur border-b border-white/10">
            <tr className={thBase}>
              <th>Time</th>
              <th>Away</th>
              <th>Home</th>
              <th>Spread</th>
              <th>Total</th>
              <th>ML Away</th>
              <th>ML Home</th>
              <th className="text-center">Market</th>
              <th>Away PR</th>
              <th>Home PR</th>
              <th>HCA</th>
              <th>Model Spr</th>
              <th>Edge</th>
              <th>Signal</th>
              <th>Rec</th>
              <th className="text-right">Best Line</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10">
            {filtered.map((g) => {
              const open = openGameId === g.gameId;

              return (
                <Fragment key={g.gameId}>
                  <tr
                    className={`cursor-pointer transition-colors hover:bg-white/[0.03] ${rowTint(
                      g.model.signal
                    )}`}
                    onClick={() => toggleRow(g)}
                    title="Click to expand team details"
                  >
                    <td
                      className={`${tdBase} text-zinc-400 whitespace-nowrap align-middle ${railClass(
                        g.model.signal
                      )}`}
                    >
                      {fmtTime(g.startTimeISO)}
                    </td>

                    <td className={`${tdBase} align-middle`}>
                      <TeamCell name={g.awayTeam} logo={g.awayLogo} />
                    </td>

                    <td className={`${tdBase} align-middle`}>
                      <TeamCell name={g.homeTeam} logo={g.homeLogo} />
                    </td>

                    <td className={`${tdBase} tabular-nums text-zinc-200`}>
                      {fmtNum(g.consensus?.spread, 1)}
                    </td>
                    <td className={`${tdBase} tabular-nums text-zinc-200`}>
                      {fmtNum(g.consensus?.total, 1)}
                    </td>
                    <td className={`${tdBase} tabular-nums text-zinc-200`}>
                      {fmtInt(g.consensus?.moneylineAway)}
                    </td>
                    <td className={`${tdBase} tabular-nums text-zinc-200`}>
                      {fmtInt(g.consensus?.moneylineHome)}
                    </td>

                    <td className={`${tdBase} text-center`}>
                      <MarketCell source={g.consensus?.source ?? null} />
                    </td>

                    <td className={`${tdBase} tabular-nums text-zinc-200`}>
                      {fmtNum(g.model?.awayPR, 1)}
                    </td>
                    <td className={`${tdBase} tabular-nums text-zinc-200`}>
                      {fmtNum(g.model?.homePR, 1)}
                    </td>
                    <td className={`${tdBase} tabular-nums text-zinc-200`}>
                      {fmtNum(g.model?.hca, 1)}
                    </td>

                    <td
                      className={`${tdBase} font-semibold tabular-nums ${modelSpreadClass(
                        g.model?.modelSpread
                      )}`}
                    >
                      {fmtNum(g.model?.modelSpread, 1)}
                    </td>

                    <td
                      className={`${tdBase} font-semibold tabular-nums ${edgeClass(
                        g.model.edge
                      )}`}
                    >
                      {fmtNum(g.model?.edge, 1)}
                    </td>

                    <td className={`${tdBase}`}>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${signalPillClass(
                          g.model.signal
                        )}`}
                      >
                        {g.model.signal}
                      </span>
                    </td>

                    <td className={`${tdBase}`}>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${recPillClass(
                          g.recommended?.side
                        )}`}
                      >
                        {g.recommended?.side ?? "NONE"}
                      </span>
                    </td>

                    <td className={`${tdBase} tabular-nums text-right`}>
                      {g.recommended?.side === "NONE" ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <BestLineCell
                          line={g.recommended?.line ?? null}
                          book={g.recommended?.book ?? null}
                        />
                      )}
                    </td>
                  </tr>

                  {open ? (
                    <tr className="bg-zinc-950/[0.03]">
                      <td colSpan={16} className="px-3 py-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <TeamExpandedCard
                            title={g.awayTeam}
                            t={getStats(g.awayTeamId)}
                          />
                          <TeamExpandedCard
                            title={g.homeTeam}
                            t={getStats(g.homeTeamId)}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="px-4 py-6 text-sm text-zinc-400">
          No games match the current filter.
        </div>
      ) : null}
    </div>
  );
}
