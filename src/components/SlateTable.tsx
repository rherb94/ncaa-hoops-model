"use client";

import { Fragment, useMemo, useState } from "react";
import type { SlateGame } from "@/lib/types";

type TeamStats = {
  teamId: string;
  teamName: string;
  season: { games: number; tempo: number; off: number; def: number };
  last5: { w: number; l: number };
  last10: { w: number; l: number };
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

function fmtNum(n: number | undefined, digits = 1) {
  if (n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtInt(n: number | undefined) {
  if (n === undefined || Number.isNaN(n)) return "—";
  return String(n);
}

function edgeClass(edge?: number) {
  if (edge === undefined || Number.isNaN(edge)) return "text-zinc-400";
  const a = Math.abs(edge);
  if (a >= 8) return edge > 0 ? "text-emerald-200" : "text-rose-200";
  if (a >= 4) return edge > 0 ? "text-emerald-300/90" : "text-rose-300/90";
  if (a >= 2) return edge > 0 ? "text-emerald-300/70" : "text-rose-300/70";
  return "text-zinc-300";
}

function modelSpreadClass(modelSpread?: number) {
  if (modelSpread === undefined || Number.isNaN(modelSpread))
    return "text-zinc-400";
  // HOME spread convention: negative => home favored
  return modelSpread < 0 ? "text-rose-200" : "text-emerald-200";
}

function signalPillClass(signal?: SlateGame["model"]["signal"]) {
  switch (signal) {
    case "STRONG":
      return "border-emerald-300/50 bg-emerald-500/15 text-emerald-50";
    case "LEAN":
      return "border-amber-300/50 bg-amber-500/15 text-amber-50";
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

function rowDecor(signal?: SlateGame["model"]["signal"]) {
  // Pro look: left accent bar + subtle tint (keeps text readable)
  if (signal === "STRONG") {
    return {
      border: "border-l-4 border-emerald-400/80",
      bg: "bg-emerald-500/[0.07]",
      ring: "shadow-[inset_0_0_0_1px_rgba(16,185,129,0.18)]",
    };
  }
  if (signal === "LEAN") {
    return {
      border: "border-l-4 border-amber-400/70",
      bg: "bg-amber-400/[0.06]",
      ring: "shadow-[inset_0_0_0_1px_rgba(251,191,36,0.12)]",
    };
  }
  return {
    border: "border-l-4 border-transparent",
    bg: "",
    ring: "",
  };
}

async function fetchTeamStats(teamId: string): Promise<TeamStats> {
  const res = await fetch(
    `/api/team-stats?teamId=${encodeURIComponent(teamId)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`team-stats failed (${res.status})`);
  return res.json();
}

function TeamCell({ name, logo }: { name: string; logo?: string | null }) {
  return (
    <div className="flex items-center gap-2">
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
      <div className="leading-tight">
        <div className="font-medium text-zinc-100">{name}</div>
      </div>
    </div>
  );
}

function BookLogo({
  book,
  size = 18,
}: {
  book?: string | null;
  size?: number;
}) {
  const b = (book ?? "").toLowerCase();

  const src = b.includes("fanduel")
    ? "/logos/books/fanduel.png"
    : b.includes("draftkings") || b === "dk"
    ? "/logos/books/draftkings.png"
    : b.includes("betmgm")
    ? "/logos/books/betmgm.png"
    : null;

  if (!src) {
    return (
      <span className="rounded-full border border-white/10 bg-zinc-900/60 px-2 py-0.5 text-xs text-zinc-200">
        {book ?? "—"}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-center">
      <img
        src={src}
        alt={book ?? ""}
        width={size}
        height={size}
        className="h-[18px] w-[18px] object-contain opacity-95"
        loading="lazy"
      />
    </span>
  );
}

export default function SlateTable({ games }: { games: SlateGame[] }) {
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, TeamStats>>({});
  const [err, setErr] = useState<string | null>(null);

  const [filter, setFilter] = useState<"ALL" | "PICKS" | "STRONG">("ALL");
  const [compact, setCompact] = useState(false);

  const counts = useMemo(() => {
    let strong = 0;
    let lean = 0;
    for (const g of games ?? []) {
      if (g.model.signal === "STRONG") strong++;
      else if (g.model.signal === "LEAN") lean++;
    }
    return { strong, lean, total: games?.length ?? 0 };
  }, [games]);

  const sorted = useMemo(() => {
    if (!games?.length) return [];

    const filtered = games.filter((g) => {
      if (filter === "STRONG") return g.model.signal === "STRONG";
      if (filter === "PICKS")
        return g.model.signal === "STRONG" || g.model.signal === "LEAN";
      return true;
    });

    const copy = [...filtered];
    copy.sort((a, b) => {
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

    return copy;
  }, [games, filter]);

  if (!games?.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-sm text-zinc-300">
        No games returned.
      </div>
    );
  }

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

  const renderTeamStats = (teamId: string) => {
    const t = stats[teamId];
    if (!t) return <span className="text-zinc-500">Loading…</span>;

    return (
      <div className="space-y-1 text-xs text-zinc-200">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="text-zinc-400">L5:</span>
          <span className="font-medium">
            {t.last5.w}-{t.last5.l}
          </span>

          <span className="text-zinc-400">L10:</span>
          <span className="font-medium">
            {t.last10.w}-{t.last10.l}
          </span>

          <span className="text-zinc-400">Season tempo:</span>
          <span className="font-medium">{fmtNum(t.season.tempo, 1)}</span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="text-zinc-400">Season off:</span>
          <span className="font-medium">{fmtNum(t.season.off, 1)}</span>

          <span className="text-zinc-400">Season def:</span>
          <span className="font-medium">{fmtNum(t.season.def, 1)}</span>

          <span className="text-zinc-500">({t.season.games} games)</span>
        </div>
      </div>
    );
  };

  const rowPad = compact ? "py-2.5" : "py-3";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-100">
              Daily Slate
            </div>
            <div className="text-xs text-zinc-400">
              Sorted by Signal → |Edge| → Time
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {counts.total} games •{" "}
              <span className="text-amber-200/90">{counts.lean} LEAN</span> •{" "}
              <span className="text-emerald-200/90">
                {counts.strong} STRONG
              </span>
            </div>
            {err ? (
              <div className="mt-2 text-xs text-rose-200">{err}</div>
            ) : null}
          </div>

          {/* slick controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-full border border-white/10 bg-zinc-900/50">
              <button
                className={`px-3 py-1.5 text-xs ${
                  filter === "ALL"
                    ? "bg-white/10 text-zinc-100"
                    : "text-zinc-300 hover:bg-white/5"
                }`}
                onClick={() => setFilter("ALL")}
                type="button"
              >
                All
              </button>
              <button
                className={`px-3 py-1.5 text-xs ${
                  filter === "PICKS"
                    ? "bg-white/10 text-zinc-100"
                    : "text-zinc-300 hover:bg-white/5"
                }`}
                onClick={() => setFilter("PICKS")}
                type="button"
              >
                Picks
              </button>
              <button
                className={`px-3 py-1.5 text-xs ${
                  filter === "STRONG"
                    ? "bg-white/10 text-zinc-100"
                    : "text-zinc-300 hover:bg-white/5"
                }`}
                onClick={() => setFilter("STRONG")}
                type="button"
              >
                Strong
              </button>
            </div>

            <button
              className={`rounded-full border px-3 py-1.5 text-xs ${
                compact
                  ? "border-white/15 bg-white/10 text-zinc-100"
                  : "border-white/10 bg-zinc-900/50 text-zinc-300 hover:bg-white/5"
              }`}
              onClick={() => setCompact((v) => !v)}
              type="button"
              title="Toggle compact row height"
            >
              Compact
            </button>
          </div>
        </div>
      </div>

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
            <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
              <th>Time</th>
              <th>Away</th>
              <th>Home</th>
              <th>Spread</th>
              <th>Total</th>
              <th>ML Away</th>
              <th>ML Home</th>
              <th>Market</th>
              <th>Away PR</th>
              <th>Home PR</th>
              <th>HCA</th>
              <th>Model Spr</th>
              <th>Edge</th>
              <th>Signal</th>
              <th>Rec</th>
              <th>Best Line</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10">
            {sorted.map((g, idx) => {
              const open = openGameId === g.gameId;
              const deco = rowDecor(g.model.signal);

              const zebra = idx % 2 === 0 ? "bg-white/[0.01]" : "";
              const openFx = open
                ? "shadow-[inset_0_-1px_0_rgba(255,255,255,0.10)]"
                : "";

              return (
                <Fragment key={g.gameId}>
                  <tr
                    className={[
                      "cursor-pointer transition-colors",
                      "hover:bg-white/[0.04]",
                      "focus-within:bg-white/[0.04]",
                      deco.border,
                      deco.bg || zebra,
                      deco.ring,
                      openFx,
                    ].join(" ")}
                    onClick={() => toggleRow(g)}
                    title="Click to expand L5/L10 + season tempo/off/def"
                  >
                    <td
                      className={`px-3 ${rowPad} text-zinc-400 whitespace-nowrap align-middle`}
                    >
                      {fmtTime(g.startTimeISO)}
                    </td>

                    <td className={`px-3 ${rowPad} align-middle`}>
                      <TeamCell name={g.awayTeam} logo={g.awayLogo} />
                    </td>

                    <td className={`px-3 ${rowPad} align-middle`}>
                      <TeamCell name={g.homeTeam} logo={g.homeLogo} />
                    </td>

                    <td className={`px-3 ${rowPad} tabular-nums text-zinc-200`}>
                      {fmtNum(g.consensus?.spread, 1)}
                    </td>
                    <td className={`px-3 ${rowPad} tabular-nums text-zinc-200`}>
                      {fmtNum(g.consensus?.total, 1)}
                    </td>
                    <td className={`px-3 ${rowPad} tabular-nums text-zinc-200`}>
                      {fmtInt(g.consensus?.moneylineAway)}
                    </td>
                    <td className={`px-3 ${rowPad} tabular-nums text-zinc-200`}>
                      {fmtInt(g.consensus?.moneylineHome)}
                    </td>

                    <td className={`px-3 ${rowPad}`}>
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-zinc-900/60">
                        <BookLogo
                          book={g.consensus?.source ?? null}
                          size={18}
                        />
                      </span>
                    </td>

                    <td className={`px-3 ${rowPad} tabular-nums text-zinc-200`}>
                      {fmtNum(g.model?.awayPR, 1)}
                    </td>
                    <td className={`px-3 ${rowPad} tabular-nums text-zinc-200`}>
                      {fmtNum(g.model?.homePR, 1)}
                    </td>
                    <td className={`px-3 ${rowPad} tabular-nums text-zinc-200`}>
                      {fmtNum(g.model?.hca, 1)}
                    </td>

                    <td
                      className={`px-3 ${rowPad} font-semibold tabular-nums ${modelSpreadClass(
                        g.model?.modelSpread
                      )}`}
                    >
                      {fmtNum(g.model?.modelSpread, 1)}
                    </td>

                    <td
                      className={`px-3 ${rowPad} font-semibold tabular-nums ${edgeClass(
                        g.model.edge
                      )}`}
                    >
                      {fmtNum(g.model?.edge, 1)}
                    </td>

                    <td className={`px-3 ${rowPad}`}>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${signalPillClass(
                          g.model.signal
                        )}`}
                      >
                        {g.model.signal}
                      </span>
                    </td>

                    <td className={`px-3 ${rowPad}`}>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${recPillClass(
                          g.recommended?.side
                        )}`}
                      >
                        {g.recommended?.side ?? "NONE"}
                      </span>
                    </td>

                    <td className={`px-3 ${rowPad} tabular-nums`}>
                      {g.recommended?.side === "NONE" ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-zinc-100">
                          <span>{fmtNum(g.recommended?.line, 1)}</span>
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-zinc-900/60">
                            <BookLogo
                              book={g.recommended?.book ?? null}
                              size={16}
                            />
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>

                  {open ? (
                    <tr className="bg-zinc-950/[0.03]">
                      <td colSpan={16} className="px-3 py-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                            <div className="mb-1 text-xs font-semibold text-zinc-100">
                              {g.awayTeam}
                            </div>
                            {renderTeamStats(g.awayTeamId)}
                          </div>
                          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                            <div className="mb-1 text-xs font-semibold text-zinc-100">
                              {g.homeTeam}
                            </div>
                            {renderTeamStats(g.homeTeamId)}
                          </div>
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
    </div>
  );
}
