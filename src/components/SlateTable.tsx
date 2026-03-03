"use client";

import React, { Fragment, useMemo, useState } from "react";
import type { SlateGame } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type TeamStats = {
  teamId: string;
  teamName: string;
  conference?: string | null;
  record?: string | null;
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

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}

function fmtNum(n: number | undefined | null, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

function fmtInt(n: number | undefined | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return String(Math.trunc(n));
}

function fmtPct(n: number | undefined | null, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(Number(n) * 100).toFixed(digits)}%`;
}

function fmtSpread(n: number | undefined | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return n > 0 ? `+${fmtNum(n)}` : fmtNum(n);
}

function fmtML(n: number | undefined | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return n > 0 ? `+${Math.trunc(n)}` : String(Math.trunc(n));
}

function modelPrefersSide(edge?: number | null): "HOME" | "AWAY" | null {
  if (edge == null || edge === 0) return null;
  return edge < 0 ? "HOME" : "AWAY";
}

function bookLogoSrc(book?: string | null) {
  if (!book) return null;
  const k = book.toLowerCase();
  if (k.includes("draft")) return "/logos/books/draftkings.png";
  if (k.includes("fan")) return "/logos/books/fanduel.png";
  if (k.includes("mgm")) return "/logos/books/betmgm.png";
  return null;
}

// ── Row / rail styling ────────────────────────────────────────────────────────

function rowTint(signal?: SlateGame["model"]["signal"]) {
  if (signal === "STRONG") return "bg-emerald-500/[0.07]";
  if (signal === "LEAN")   return "bg-amber-400/[0.06]";
  return "";
}

function railClass(signal?: SlateGame["model"]["signal"]) {
  if (signal === "STRONG") return "border-l-2 border-emerald-400/60";
  if (signal === "LEAN")   return "border-l-2 border-amber-400/50";
  return "border-l-2 border-transparent";
}

// ── Neutral badge ─────────────────────────────────────────────────────────────

function NeutralBadge() {
  return (
    <span
      title="Neutral site — HCA set to 0"
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20"
    >
      ⚬ NEUTRAL
    </span>
  );
}

// ── Edge cell ─────────────────────────────────────────────────────────────────

function EdgeCell({ edge }: { edge?: number | null }) {
  if (edge == null || Number.isNaN(edge))
    return <span className="text-zinc-600">—</span>;
  const a = Math.abs(edge);
  const color =
    a >= 5 ? "text-emerald-400" :
    a >= 3 ? "text-amber-400" :
    "text-zinc-500";
  const label = edge > 0 ? `+${fmtNum(edge)}` : fmtNum(edge);
  return <span className={`font-mono text-xs font-semibold ${color}`}>{label}</span>;
}

// ── Pick text (plain colored, no pill — mirrors Results page) ─────────────────

function PickText({
  signal,
  side,
  line,
}: {
  signal: SlateGame["model"]["signal"];
  side?: "HOME" | "AWAY" | "NONE";
  line?: number | null;
}) {
  if (signal === "NONE" || !side || side === "NONE")
    return <span className="text-zinc-600 text-xs">—</span>;

  const displayLine = line != null && side === "AWAY" ? -line : line;
  const lineStr =
    displayLine != null && !Number.isNaN(displayLine)
      ? displayLine > 0 ? `+${fmtNum(displayLine)}` : fmtNum(displayLine)
      : null;

  const color = signal === "STRONG" ? "text-emerald-400" : "text-amber-400";

  return (
    <span className={`text-xs font-semibold ${color}`}>
      {signal} {side}{lineStr ? ` ${lineStr}` : ""}
    </span>
  );
}

// ── Game cell (stacked away @ home, no emoji) ─────────────────────────────────

function GameCell({ g }: { g: SlateGame }) {
  const preferred = modelPrefersSide(g.model.edge);
  const hasPick = g.model.signal !== "NONE";

  function TeamRow({ name, logo, isPreferred }: { name: string; logo?: string | null; isPreferred: boolean }) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        {logo
          ? <img src={logo} alt="" className="h-5 w-5 shrink-0 rounded-sm object-contain opacity-90" loading="lazy" />
          : <div className="h-5 w-5 shrink-0 rounded-sm bg-zinc-800" />
        }
        <span
          title={name}
          className={`truncate text-sm leading-snug ${
            isPreferred && hasPick   ? "font-semibold text-zinc-100" :
            hasPick && preferred     ? "text-zinc-500" :
            "text-zinc-300"
          }`}
        >
          {name}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-px min-w-0">
      <TeamRow name={g.awayTeam} logo={g.awayLogo} isPreferred={preferred === "AWAY"} />
      <div className="pl-0.5 text-[10px] font-medium text-zinc-700 select-none leading-none py-0.5">@</div>
      <TeamRow name={g.homeTeam} logo={g.homeLogo} isPreferred={preferred === "HOME"} />
      {g.neutralSite && <div className="mt-1"><NeutralBadge /></div>}
    </div>
  );
}

// ── Expand: game info bar ─────────────────────────────────────────────────────

function GameInfoBar({ g }: { g: SlateGame }) {
  const logoSrc = bookLogoSrc(g.recommended?.book);
  const displayLine = g.recommended?.line != null && g.recommended?.side === "AWAY"
    ? -g.recommended.line
    : g.recommended?.line;
  const lineStr = displayLine != null ? fmtSpread(displayLine) : null;

  const items = [
    { label: "ML Away",  value: fmtML(g.consensus?.moneylineAway) },
    { label: "ML Home",  value: fmtML(g.consensus?.moneylineHome) },
    { label: "Total",    value: g.consensus?.total != null ? fmtNum(g.consensus.total) : null },
    { label: "PR (A/H)", value: `${fmtNum(g.model.awayPR)} / ${fmtNum(g.model.homePR)}` },
    { label: "HCA",      value: fmtNum(g.model.hca) },
    { label: "Model",    value: fmtSpread(g.model.modelSpread) },
  ].filter(item => item.value !== null) as { label: string; value: string }[];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <span className="text-[11px] text-zinc-600">{item.label}</span>
          <span className="text-xs font-medium text-zinc-300 tabular-nums font-mono">{item.value}</span>
        </div>
      ))}
      {/* Best line */}
      {g.recommended?.side && g.recommended.side !== "NONE" && (
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-600">Best line</span>
          {logoSrc && (
            <img src={logoSrc} alt={g.recommended.book ?? ""} className="h-4 w-4 rounded object-contain opacity-70" title={g.recommended.book ?? ""} />
          )}
          {lineStr && (
            <span className="text-xs font-medium text-zinc-300 tabular-nums font-mono">{lineStr}</span>
          )}
          {!logoSrc && g.recommended.book && (
            <span className="text-xs text-zinc-500">{g.recommended.book}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Expand: team stats card ───────────────────────────────────────────────────

function StatRow({ label, value, rank }: { label: string; value: string; rank?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-600">{label}</span>
      <div className="flex items-center gap-1.5 tabular-nums">
        <span className="font-medium text-zinc-200">{value}</span>
        {rank && <span className="text-zinc-600">{rank}</span>}
      </div>
    </div>
  );
}

function TeamCard({ title, logo, t }: { title: string; logo?: string | null; t?: TeamStats }) {
  const conf = t?.conference ?? null;
  const record = t?.record ?? null;
  const adjMargin = t?.adjOff != null && t?.adjDef != null ? Number(t.adjOff) - Number(t.adjDef) : null;

  return (
    <div className="rounded-xl border border-white/8 bg-black/15 p-4">
      {/* Team header */}
      <div className="flex items-center gap-2.5 mb-3">
        {logo
          ? <img src={logo} alt="" className="h-7 w-7 shrink-0 rounded-sm object-contain opacity-90" />
          : <div className="h-7 w-7 shrink-0 rounded-sm bg-zinc-800" />
        }
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100 truncate" title={title}>{title}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {conf && <span className="text-[11px] text-zinc-500">{conf}</span>}
            {conf && record && <span className="text-zinc-700">·</span>}
            {record && <span className="text-[11px] text-zinc-500">{record}</span>}
          </div>
        </div>
        <div className="ml-auto text-[10px] text-zinc-700 shrink-0">Torvik</div>
      </div>

      {!t ? (
        <div className="text-xs text-zinc-600">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <StatRow label="Power Rank" value={t.powerRank ? `#${t.powerRank}` : "—"} />
          <StatRow
            label="Adj. Off"
            value={fmtNum(t.adjOff)}
            rank={t.ranks?.adjOff ? `#${fmtInt(t.ranks.adjOff)}` : undefined}
          />
          <StatRow
            label="Barthag"
            value={fmtPct(t.barthag)}
            rank={t.ranks?.barthag ? `#${fmtInt(t.ranks.barthag)}` : undefined}
          />
          <StatRow
            label="Adj. Def"
            value={fmtNum(t.adjDef)}
            rank={t.ranks?.adjDef ? `#${fmtInt(t.ranks.adjDef)}` : undefined}
          />
          <StatRow label="Adj. Margin" value={adjMargin == null ? "—" : fmtNum(adjMargin)} />
          <StatRow
            label="Tempo"
            value={fmtNum(t.tempo)}
            rank={t.ranks?.tempo ? `#${fmtInt(t.ranks.tempo)}` : undefined}
          />
        </div>
      )}
    </div>
  );
}

// ── Group separator row ───────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={6} className="px-4 pt-4 pb-1">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-600">
            {label}
          </span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
      </td>
    </tr>
  );
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchTeamStats(teamId: string): Promise<TeamStats> {
  const res = await fetch(`/api/team-stats?teamId=${encodeURIComponent(teamId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`team-stats failed (${res.status})`);
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

type FilterMode = "ALL" | "PICKS" | "STRONG";

export default function SlateTable({ games }: { games: SlateGame[] }) {
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, TeamStats>>({});
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("ALL");

  const now = Date.now();

  const upcoming = useMemo(() =>
    (games ?? []).filter((g) => {
      const t = new Date(g.startTimeISO).getTime();
      return Number.isFinite(t) ? t > now : true;
    }),
    [games, now]
  );

  const counts = useMemo(() => ({
    games:  upcoming.length,
    lean:   upcoming.filter((g) => g.model.signal === "LEAN").length,
    strong: upcoming.filter((g) => g.model.signal === "STRONG").length,
  }), [upcoming]);

  const filtered = useMemo(() => {
    let arr = [...upcoming];
    if (filter === "PICKS")  arr = arr.filter((g) => g.model.signal !== "NONE");
    if (filter === "STRONG") arr = arr.filter((g) => g.model.signal === "STRONG");

    arr.sort((a, b) => {
      const rank = (s: SlateGame["model"]["signal"]) => s === "STRONG" ? 2 : s === "LEAN" ? 1 : 0;
      const r = rank(b.model.signal) - rank(a.model.signal);
      if (r !== 0) return r;
      const ea = Math.abs(a.model.edge ?? 0), eb = Math.abs(b.model.edge ?? 0);
      if (ea !== eb) return eb - ea;
      return new Date(a.startTimeISO).getTime() - new Date(b.startTimeISO).getTime();
    });

    return arr;
  }, [upcoming, filter]);

  // Index where NONE games begin (for group divider)
  const firstNoneIdx = useMemo(() =>
    filter === "ALL" ? filtered.findIndex((g) => g.model.signal === "NONE") : -1,
    [filtered, filter]
  );

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

  const thCls = "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-600 text-left";
  const tdBase = "px-3 py-3";

  return (
    <div className="rounded-2xl border border-white/8 bg-zinc-950/60">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 border-b border-white/8 px-5 py-3.5">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-sm font-semibold text-zinc-100 shrink-0">Daily Slate</span>
          <span className="text-xs text-zinc-600 truncate">
            {counts.games} games
            {counts.strong > 0 && <> · <span className="text-emerald-400">{counts.strong} STRONG</span></>}
            {counts.lean   > 0 && <> · <span className="text-amber-400">{counts.lean} LEAN</span></>}
          </span>
          {err && <span className="text-xs text-rose-400 shrink-0">{err}</span>}
        </div>

        <div className="flex rounded-lg border border-white/10 bg-zinc-900/80 p-0.5 shrink-0">
          {(["ALL", "PICKS", "STRONG"] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filter === f ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f === "ALL" ? "All" : f === "PICKS" ? "Lean+" : "Strong"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-[860px] w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[80px]" />  {/* Time */}
            <col className="w-[280px]" /> {/* Game */}
            <col className="w-[76px]" />  {/* Spread */}
            <col className="w-[76px]" />  {/* Model */}
            <col className="w-[72px]" />  {/* Edge */}
            <col />                        {/* Pick — flex fills remainder */}
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
            {filtered.map((g, i) => {
              const open = openGameId === g.gameId;
              return (
                <Fragment key={g.gameId}>
                  {/* Group divider between picks and other games */}
                  {i === firstNoneIdx && firstNoneIdx > 0 && (
                    <SectionDivider label="Other games" />
                  )}

                  <tr
                    className={`cursor-pointer transition-colors hover:bg-white/[0.025] ${rowTint(g.model.signal)}`}
                    onClick={() => toggleRow(g)}
                  >
                    {/* Time */}
                    <td className={`${tdBase} whitespace-nowrap align-middle ${railClass(g.model.signal)}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-zinc-500">{fmtTime(g.startTimeISO)}</span>
                        <span className={`text-[9px] text-zinc-700 transition-transform duration-150 ${open ? "rotate-180" : ""}`}>▼</span>
                      </div>
                    </td>

                    {/* Game */}
                    <td className={`${tdBase} align-middle`}>
                      <GameCell g={g} />
                    </td>

                    {/* Spread */}
                    <td className={`${tdBase} align-middle font-mono text-xs tabular-nums text-zinc-400`}>
                      {fmtSpread(g.consensus?.spread)}
                    </td>

                    {/* Model */}
                    <td className={`${tdBase} align-middle font-mono text-xs tabular-nums font-semibold ${
                      (g.model?.modelSpread ?? 0) < 0 ? "text-rose-300/80" : "text-emerald-300/80"
                    }`}>
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
                      />
                    </td>
                  </tr>

                  {/* Expand row */}
                  {open && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 bg-black/20 border-b border-white/[0.05]">
                        <GameInfoBar g={g} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <TeamCard title={g.awayTeam} logo={g.awayLogo} t={stats[g.awayTeamId]} />
                          <TeamCard title={g.homeTeam} logo={g.homeLogo} t={stats[g.homeTeamId]} />
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
        {filtered.map((g, i) => {
          const open = openGameId === g.gameId;
          const preferred = modelPrefersSide(g.model.edge);
          const hasPick = g.model.signal !== "NONE";

          return (
            <div key={g.gameId}>
              {/* Mobile section divider */}
              {i === firstNoneIdx && firstNoneIdx > 0 && (
                <div className="flex items-center gap-3 px-4 pt-4 pb-1">
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-600">Other games</span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>
              )}

              <div
                className={`cursor-pointer px-4 py-3 transition-colors hover:bg-white/[0.025] ${rowTint(g.model.signal)} ${railClass(g.model.signal)}`}
                onClick={() => toggleRow(g)}
              >
                {/* Time + pick + chevron */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-600">{fmtTime(g.startTimeISO)}</span>
                  <div className="flex items-center gap-2">
                    <PickText signal={g.model.signal} side={g.recommended?.side} line={g.recommended?.line ?? null} />
                    <span className={`text-[9px] text-zinc-700 transition-transform duration-150 ${open ? "rotate-180" : ""}`}>▼</span>
                  </div>
                </div>

                {/* Teams */}
                <div className="flex flex-col gap-px mb-2">
                  {[{ name: g.awayTeam, logo: g.awayLogo, side: "AWAY" }, { name: g.homeTeam, logo: g.homeLogo, side: "HOME" }].map((team, ti) => (
                    <React.Fragment key={team.side}>
                      {ti === 1 && <div className="pl-0.5 text-[10px] text-zinc-700 select-none leading-none py-0.5">@</div>}
                      <div className="flex items-center gap-2">
                        {team.logo
                          ? <img src={team.logo} alt="" className="h-5 w-5 shrink-0 rounded-sm object-contain opacity-90" loading="lazy" />
                          : <div className="h-5 w-5 shrink-0 rounded-sm bg-zinc-800" />
                        }
                        <span className={`text-sm truncate ${
                          preferred === team.side && hasPick ? "font-semibold text-zinc-100" :
                          hasPick && preferred ? "text-zinc-500" : "text-zinc-300"
                        }`} title={team.name}>{team.name}</span>
                      </div>
                    </React.Fragment>
                  ))}
                  {g.neutralSite && <div className="mt-1"><NeutralBadge /></div>}
                </div>

                {/* Spread + edge */}
                <div className="flex gap-4 text-xs text-zinc-600">
                  <span>Spread <span className="text-zinc-400 font-mono">{fmtSpread(g.consensus?.spread)}</span></span>
                  <span>Edge <EdgeCell edge={g.model?.edge} /></span>
                </div>
              </div>

              {open && (
                <div className="px-4 py-4 bg-black/20">
                  <GameInfoBar g={g} />
                  <div className="grid gap-3">
                    <TeamCard title={g.awayTeam} logo={g.awayLogo} t={stats[g.awayTeamId]} />
                    <TeamCard title={g.homeTeam} logo={g.homeLogo} t={stats[g.homeTeamId]} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="px-5 py-10 text-sm text-zinc-600 text-center">
          No games match the current filter.
        </div>
      )}
    </div>
  );
}
