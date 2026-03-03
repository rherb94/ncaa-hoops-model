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

function fmtSpread(n: number | undefined | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n > 0 ? `+${fmtNum(n)}` : fmtNum(n);
}

function fmtML(n: number | undefined | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n > 0 ? `+${Math.trunc(n)}` : String(Math.trunc(n));
}

function modelPrefersSide(edge?: number | null): "HOME" | "AWAY" | null {
  if (edge == null || edge === 0) return null;
  return edge < 0 ? "HOME" : "AWAY";
}

// ── Edge cell ─────────────────────────────────────────────────────────────────

function EdgeCell({ edge }: { edge?: number | null }) {
  if (edge === undefined || edge === null || Number.isNaN(edge))
    return <span className="text-zinc-600">—</span>;

  const a = Math.abs(edge);
  const color =
    a >= 5 ? (edge > 0 ? "text-emerald-400" : "text-emerald-400") :
    a >= 3 ? "text-amber-400" :
    "text-zinc-500";

  const label = edge > 0 ? `+${fmtNum(edge)}` : fmtNum(edge);
  return <span className={`font-mono text-xs font-semibold ${color}`}>{label}</span>;
}

// ── Row styling ───────────────────────────────────────────────────────────────

function rowTint(signal?: SlateGame["model"]["signal"]) {
  if (signal === "STRONG") return "bg-emerald-500/[0.07]";
  if (signal === "LEAN") return "bg-amber-400/[0.06]";
  return "";
}

function railClass(signal?: SlateGame["model"]["signal"]) {
  if (signal === "STRONG") return "border-l-2 border-emerald-400/60";
  if (signal === "LEAN") return "border-l-2 border-amber-400/50";
  return "border-l-2 border-transparent";
}

// ── Book logo ─────────────────────────────────────────────────────────────────

function bookLogoSrc(book?: string | null) {
  if (!book) return null;
  const k = String(book).toLowerCase().trim();
  if (k.includes("draft")) return "/logos/books/draftkings.png";
  if (k.includes("fan")) return "/logos/books/fanduel.png";
  if (k.includes("mgm")) return "/logos/books/betmgm.png";
  return null;
}

// ── Neutral site badge ────────────────────────────────────────────────────────

function NeutralBadge() {
  return (
    <span
      title="Neutral site game — HCA set to 0"
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20"
    >
      <span>⚬</span> NEUTRAL
    </span>
  );
}

// ── Pick text (plain colored text, like Results page) ─────────────────────────

function PickText({
  signal,
  side,
  line,
  book,
}: {
  signal: SlateGame["model"]["signal"];
  side?: "HOME" | "AWAY" | "NONE";
  line?: number | null;
  book?: string | null;
}) {
  if (signal === "NONE" || !side || side === "NONE") {
    return <span className="text-zinc-600 text-xs">—</span>;
  }

  const displayLine = line != null && side === "AWAY" ? -line : line;
  const lineStr =
    displayLine != null && !Number.isNaN(displayLine)
      ? displayLine > 0
        ? `+${fmtNum(displayLine)}`
        : fmtNum(displayLine)
      : null;

  const color = signal === "STRONG" ? "text-emerald-400" : "text-amber-400";
  const logoSrc = bookLogoSrc(book);

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-semibold ${color}`}>
        {signal} {side}{lineStr ? ` ${lineStr}` : ""}
      </span>
      {logoSrc && (
        <img
          src={logoSrc}
          alt={book ?? ""}
          className="h-4 w-4 rounded object-contain opacity-60"
          loading="lazy"
          title={book ?? ""}
        />
      )}
    </div>
  );
}

// ── Game cell (stacked away @ home) ──────────────────────────────────────────

function GameCell({ g }: { g: SlateGame }) {
  const preferred = modelPrefersSide(g.model.edge);
  const hasPick = g.model.signal !== "NONE";

  function TeamRow({
    name,
    logo,
    isPreferred,
  }: {
    name: string;
    logo?: string | null;
    isPreferred: boolean;
  }) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        {logo ? (
          <img
            src={logo}
            alt=""
            className="h-5 w-5 shrink-0 rounded-sm object-contain opacity-90"
            loading="lazy"
          />
        ) : (
          <div className="h-5 w-5 shrink-0 rounded-sm bg-zinc-800" />
        )}
        <span
          className={`truncate text-sm ${
            isPreferred && hasPick
              ? "font-semibold text-zinc-100"
              : hasPick && preferred
              ? "text-zinc-500"
              : "text-zinc-300"
          }`}
        >
          {name}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <TeamRow
        name={g.awayTeam}
        logo={g.awayLogo}
        isPreferred={preferred === "AWAY"}
      />
      <div className="pl-0.5 text-[10px] font-medium text-zinc-600 select-none">
        @
      </div>
      <TeamRow
        name={g.homeTeam}
        logo={g.homeLogo}
        isPreferred={preferred === "HOME"}
      />
      {g.neutralSite && (
        <div className="mt-0.5">
          <NeutralBadge />
        </div>
      )}
    </div>
  );
}

// ── Expand panel info bar ─────────────────────────────────────────────────────

function GameInfoBar({ g }: { g: SlateGame }) {
  const items = [
    { label: "ML Away", value: fmtML(g.consensus?.moneylineAway) },
    { label: "ML Home", value: fmtML(g.consensus?.moneylineHome) },
    { label: "PR (A/H)", value: `${fmtNum(g.model.awayPR)} / ${fmtNum(g.model.homePR)}` },
    { label: "HCA", value: fmtNum(g.model.hca) },
    ...(g.consensus?.total != null
      ? [{ label: "Total", value: fmtNum(g.consensus.total) }]
      : []),
  ];

  return (
    <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-white/8 bg-black/20 px-4 py-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <span className="text-[11px] text-zinc-500">{item.label}</span>
          <span className="text-xs font-medium text-zinc-200 tabular-nums">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Team expand card ──────────────────────────────────────────────────────────

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
      <div className="text-zinc-500">{label}</div>
      <div className="flex items-center gap-2">
        <div className="font-medium text-zinc-100 tabular-nums">{value}</div>
        {right ? (
          <div className="text-xs text-zinc-600 tabular-nums">{right}</div>
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
    <div className="rounded-xl border border-white/8 bg-black/20 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100 truncate">
            {title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {conf && (
              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
                {conf}
              </span>
            )}
            {record && <span>{record}</span>}
          </div>
        </div>
        <div className="shrink-0 text-xs text-zinc-600">Torvik</div>
      </div>

      {!t ? (
        <div className="text-sm text-zinc-600">Loading…</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5 text-xs">
            <StatRow
              label="Power Rank"
              value={t.powerRank ? `#${t.powerRank}` : "—"}
            />
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
      )}
    </div>
  );
}

async function fetchTeamStats(teamId: string): Promise<TeamStats> {
  const res = await fetch(
    `/api/team-stats?teamId=${encodeURIComponent(teamId)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`team-stats failed (${res.status})`);
  return res.json();
}

// ── Main component ────────────────────────────────────────────────────────────

type FilterMode = "ALL" | "PICKS" | "STRONG";

export default function SlateTable({ games }: { games: SlateGame[] }) {
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, TeamStats>>({});
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("ALL");

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
    if (filter === "PICKS")
      arr = arr.filter(
        (g) => g.model.signal === "LEAN" || g.model.signal === "STRONG"
      );
    else if (filter === "STRONG")
      arr = arr.filter((g) => g.model.signal === "STRONG");

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

  const thCls = "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500 text-left";
  const tdBase = "px-3 py-3";

  return (
    <div className="rounded-2xl border border-white/8 bg-zinc-950/60">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 border-b border-white/8 px-5 py-3">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold text-zinc-100">
              Daily Slate
            </span>
            <span className="text-xs text-zinc-500">
              {counts.games} games
              {counts.strong > 0 && (
                <> · <span className="text-emerald-400">{counts.strong} STRONG</span></>
              )}
              {counts.lean > 0 && (
                <> · <span className="text-amber-400">{counts.lean} LEAN</span></>
              )}
            </span>
          </div>
          {err && <div className="mt-1 text-xs text-rose-400">{err}</div>}
        </div>

        {/* Filter */}
        <div className="flex rounded-lg border border-white/10 bg-zinc-900/80 p-0.5">
          {(["ALL", "PICKS", "STRONG"] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filter === f
                  ? "bg-white/10 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f === "ALL" ? "All" : f === "PICKS" ? "Lean+" : "Strong"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-[720px] w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[80px]" />  {/* Time */}
            <col className="w-[250px]" /> {/* Game */}
            <col className="w-[70px]" />  {/* Spread */}
            <col className="w-[70px]" />  {/* Model */}
            <col className="w-[65px]" />  {/* Edge */}
            <col />                       {/* Pick — flex */}
          </colgroup>

          <thead className="border-b border-white/8">
            <tr>
              <th className={thCls}>Time</th>
              <th className={thCls}>Game</th>
              <th className={thCls}>Spread</th>
              <th className={thCls}>Model</th>
              <th className={thCls}>Edge</th>
              <th className={thCls}>Pick</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.05]">
            {filtered.map((g) => {
              const open = openGameId === g.gameId;
              const modelSpreadColor =
                (g.model?.modelSpread ?? 0) < 0 ? "text-rose-300" : "text-emerald-300";

              return (
                <Fragment key={g.gameId}>
                  <tr
                    className={`cursor-pointer transition-colors hover:bg-white/[0.025] ${rowTint(g.model.signal)}`}
                    onClick={() => toggleRow(g)}
                  >
                    {/* Time */}
                    <td className={`${tdBase} whitespace-nowrap align-middle ${railClass(g.model.signal)}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-zinc-500">{fmtTime(g.startTimeISO)}</span>
                        <span
                          className={`text-[9px] text-zinc-700 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                        >
                          ▼
                        </span>
                      </div>
                    </td>

                    {/* Game */}
                    <td className={`${tdBase} align-middle`}>
                      <GameCell g={g} />
                    </td>

                    {/* Spread */}
                    <td className={`${tdBase} text-xs tabular-nums text-zinc-300 align-middle font-mono`}>
                      {fmtSpread(g.consensus?.spread)}
                    </td>

                    {/* Model */}
                    <td className={`${tdBase} text-xs font-mono font-semibold tabular-nums align-middle ${modelSpreadColor}`}>
                      {fmtSpread(g.model?.modelSpread)}
                    </td>

                    {/* Edge */}
                    <td className={`${tdBase} align-middle`}>
                      <EdgeCell edge={g.model?.edge} />
                    </td>

                    {/* Pick */}
                    <td className={`${tdBase} align-middle`}>
                      <PickText
                        signal={g.model.signal}
                        side={g.recommended?.side}
                        line={g.recommended?.line ?? null}
                        book={g.recommended?.book ?? null}
                      />
                    </td>
                  </tr>

                  {/* Expand */}
                  {open && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 bg-black/20">
                        <GameInfoBar g={g} />
                        <div className="grid gap-3 sm:grid-cols-2">
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

      {/* ── Mobile cards ── */}
      <div className="md:hidden divide-y divide-white/[0.05]">
        {filtered.map((g) => {
          const open = openGameId === g.gameId;
          const preferred = modelPrefersSide(g.model.edge);
          const hasPick = g.model.signal !== "NONE";

          return (
            <div key={g.gameId}>
              <div
                className={`cursor-pointer px-4 py-3 transition-colors hover:bg-white/[0.025] ${rowTint(g.model.signal)} ${railClass(g.model.signal)}`}
                onClick={() => toggleRow(g)}
              >
                {/* Top row: time + pick + chevron */}
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs text-zinc-600">{fmtTime(g.startTimeISO)}</span>
                  <div className="flex items-center gap-2">
                    <PickText
                      signal={g.model.signal}
                      side={g.recommended?.side}
                      line={g.recommended?.line ?? null}
                      book={g.recommended?.book ?? null}
                    />
                    <span className={`text-[9px] text-zinc-700 transition-transform duration-150 ${open ? "rotate-180" : ""}`}>▼</span>
                  </div>
                </div>

                {/* Teams */}
                <div className="flex flex-col gap-0.5 mb-2.5">
                  {/* Away */}
                  <div className="flex items-center gap-2">
                    {g.awayLogo ? (
                      <img src={g.awayLogo} alt="" className="h-5 w-5 shrink-0 rounded-sm object-contain opacity-90" loading="lazy" />
                    ) : (
                      <div className="h-5 w-5 shrink-0 rounded-sm bg-zinc-800" />
                    )}
                    <span className={`text-sm ${preferred === "AWAY" && hasPick ? "font-semibold text-zinc-100" : hasPick && preferred ? "text-zinc-500" : "text-zinc-300"}`}>
                      {g.awayTeam}
                    </span>
                  </div>
                  <div className="pl-0.5 text-[10px] font-medium text-zinc-600 select-none">@</div>
                  {/* Home */}
                  <div className="flex items-center gap-2">
                    {g.homeLogo ? (
                      <img src={g.homeLogo} alt="" className="h-5 w-5 shrink-0 rounded-sm object-contain opacity-90" loading="lazy" />
                    ) : (
                      <div className="h-5 w-5 shrink-0 rounded-sm bg-zinc-800" />
                    )}
                    <span className={`text-sm ${preferred === "HOME" && hasPick ? "font-semibold text-zinc-100" : hasPick && preferred ? "text-zinc-500" : "text-zinc-300"}`}>
                      {g.homeTeam}
                    </span>
                  </div>
                  {g.neutralSite && <div className="mt-0.5"><NeutralBadge /></div>}
                </div>

                {/* Stats */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-zinc-600">
                  <span>
                    Spread <span className="text-zinc-400 font-mono">{fmtSpread(g.consensus?.spread)}</span>
                  </span>
                  <span>
                    Model{" "}
                    <span className={`font-mono font-semibold ${(g.model?.modelSpread ?? 0) < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                      {fmtSpread(g.model?.modelSpread)}
                    </span>
                  </span>
                  <span>
                    Edge <EdgeCell edge={g.model?.edge} />
                  </span>
                </div>
              </div>

              {/* Mobile expand */}
              {open && (
                <div className="px-4 py-4 bg-black/20">
                  <GameInfoBar g={g} />
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

      {filtered.length === 0 && (
        <div className="px-5 py-8 text-sm text-zinc-600">
          No games match the current filter.
        </div>
      )}
    </div>
  );
}
