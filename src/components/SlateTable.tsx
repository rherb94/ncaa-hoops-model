"use client";

import React, { Fragment, useEffect, useMemo, useState } from "react";
import type { SlateGame } from "@/lib/types";
import type { LeagueId } from "@/lib/leagues";
import { isPlay } from "@/lib/signal";
import type { L5Record } from "@/app/api/[league]/team-l5/route";

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

/** Desktop table row: subtle bg tint */
function rowTint(signal?: SlateGame["model"]["signal"], skipped?: boolean) {
  if (skipped) return "opacity-50";
  if (signal === "STRONG") return "bg-emerald-500/[0.09]";
  if (signal === "LEAN")   return "bg-amber-400/[0.07]";
  if (signal === "CAUTION") return "bg-zinc-500/[0.06]";
  return "";
}

/** Desktop table: left rail on Time column */
function railClass(signal?: SlateGame["model"]["signal"], skipped?: boolean) {
  if (skipped) return "border-l-[3px] border-rose-400/40";
  if (signal === "STRONG") return "border-l-[3px] border-emerald-400";
  if (signal === "LEAN")   return "border-l-[3px] border-amber-400";
  if (signal === "CAUTION") return "border-l-[3px] border-dashed border-zinc-500";
  return "border-l-[3px] border-transparent";
}

/** Mobile card: full-perimeter border + shadow glow + visible fill */
function mobileCardClass(signal?: SlateGame["model"]["signal"], skipped?: boolean) {
  if (skipped)
    return "rounded-xl border border-rose-500/20 bg-zinc-900/20 opacity-50";
  if (signal === "STRONG")
    return "rounded-xl border border-emerald-500/40 bg-emerald-500/[0.11] shadow-[0_0_22px_-4px_rgba(52,211,153,0.4)]";
  if (signal === "LEAN")
    return "rounded-xl border border-amber-400/35 bg-amber-400/[0.09] shadow-[0_0_22px_-4px_rgba(251,191,36,0.32)]";
  if (signal === "CAUTION")
    return "rounded-xl border border-dashed border-zinc-500/50 bg-zinc-500/[0.06]";
  return "rounded-xl border border-white/[0.05] bg-zinc-900/20";
}

// ── Neutral badge ─────────────────────────────────────────────────────────────

function NeutralBadge() {
  return (
    <span
      title="Neutral site — HCA set to 0"
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20"
    >
      Neutral site
    </span>
  );
}

// ── Override badges ──────────────────────────────────────────────────────────

function OverrideHomeBadge() {
  return (
    <span
      title="Override: neutral site forced to home game (HCA applied)"
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-orange-500/15 text-orange-400 border border-orange-500/20"
    >
      Home override
    </span>
  );
}

function SkipBadge({ reason }: { reason?: string }) {
  return (
    <span
      title={reason ?? "Game skipped — excluded from picks and results"}
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/20"
    >
      Skipped
    </span>
  );
}

// ── Line movement ─────────────────────────────────────────────────────────────

function LineMovement({
  current,
  opening,
  edge,
}: {
  current?: number | null;
  opening?: number | null;
  edge?: number | null;
}) {
  if (current == null || opening == null) return null;
  const diff = Math.round((current - opening) * 10) / 10;
  if (diff === 0) return null;

  // Determine if movement is favorable for the model's preferred side.
  // edge < 0 → model likes HOME → a more negative current spread is favorable
  // edge > 0 → model likes AWAY → a more positive current spread is favorable
  const favorable = edge != null && edge !== 0
    ? (edge < 0 ? diff < 0 : diff > 0)
    : null;

  const color = favorable === true
    ? "text-emerald-400"
    : favorable === false
    ? "text-red-400"
    : "text-zinc-500";

  const arrow = diff < 0 ? "▼" : "▲";

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${color}`}
      title={`Opened ${opening > 0 ? "+" : ""}${opening} → now ${current > 0 ? "+" : ""}${current}`}
    >
      {arrow}{Math.abs(diff).toFixed(1)}
    </span>
  );
}

// ── Edge cell ─────────────────────────────────────────────────────────────────

function EdgeCell({ edge, signal }: { edge?: number | null; signal?: SlateGame["model"]["signal"] }) {
  if (edge == null || Number.isNaN(edge))
    return <span className="text-zinc-600">—</span>;
  // Colour follows the signal so each sport's own thresholds apply.
  const color =
    signal === "STRONG" ? "text-emerald-400" :
    signal === "LEAN"   ? "text-amber-400" :
    signal === "CAUTION" ? "text-zinc-400" :
    "text-zinc-500";
  const label = edge > 0 ? `+${fmtNum(edge)}` : fmtNum(edge);
  return <span className={`font-mono text-sm font-semibold ${color}`}>{label}</span>;
}

// ── Pick text ─────────────────────────────────────────────────────────────────

function PickText({
  signal,
  side,
  line,
  neutralSite,
  cautionNote,
  teamName,
  compact,
}: {
  cautionNote?: string;
  /** Name of the team being picked. */
  teamName?: string;
  /** Tag and number only — for cards where the picked team is already bold. */
  compact?: boolean;
  signal: SlateGame["model"]["signal"];
  side?: "HOME" | "AWAY" | "NONE";
  line?: number | null;
  neutralSite?: boolean;
}) {
  if (signal === "CAUTION")
    return (
      <span
        className="inline-flex cursor-help items-center gap-2 text-xs"
        title={cautionNote ?? "Not a play: the model is unreliable here. Not tracked in results."}
      >
        <SignalTag signal="CAUTION" />
        <span className="text-zinc-500">No play</span>
      </span>
    );
  if (signal === "NONE" || !side || side === "NONE")
    return <span className="text-zinc-700 text-xs">—</span>;

  const displayLine = line != null && side === "AWAY" ? -line : line;
  const lineStr =
    displayLine != null && !Number.isNaN(displayLine)
      ? displayLine > 0 ? `+${fmtNum(displayLine)}` : fmtNum(displayLine)
      : null;

  // Reads as the bet itself: tag, team, number. Venue is spelled out, small.
  const venue = neutralSite ? "neutral" : side === "HOME" ? "home" : "away";

  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <SignalTag signal={signal} />
      {!compact && (
        <span className="min-w-0 truncate font-semibold text-zinc-100" title={teamName}>
          {teamName ?? (side === "HOME" ? "Home" : "Away")}
        </span>
      )}
      {lineStr && <span className="num shrink-0 font-semibold text-zinc-100">{lineStr}</span>}
      <span className="hidden shrink-0 text-xs text-zinc-600 xl:inline">{venue}</span>
    </span>
  );
}

/** The one place signal colour is defined for the slate. */
function SignalTag({ signal }: { signal: SlateGame["model"]["signal"] }) {
  const cls =
    signal === "STRONG" ? "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30" :
    signal === "LEAN"   ? "bg-amber-400/15 text-amber-300 ring-amber-400/30" :
                          "bg-zinc-500/10 text-zinc-400 ring-zinc-500/40 ring-dashed";
  const label = signal === "STRONG" ? "Strong" : signal === "LEAN" ? "Lean" : "Caution";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}

// ── Game cell (stacked away @ home, no emoji) ─────────────────────────────────

function GameCell({ g }: { g: SlateGame }) {
  const preferred = modelPrefersSide(g.model.edge);
  const hasPick = isPlay(g.model.signal);
  const preferredNameColor = "font-semibold text-zinc-100";

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
            isPreferred && hasPick   ? preferredNameColor :
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
      {g.overrides?.forceHome && <div className="mt-1"><OverrideHomeBadge /></div>}
      {g.overrides?.skip && <div className="mt-1"><SkipBadge reason={g.overrides.reason} /></div>}
    </div>
  );
}

// ── Expand: bet buttons ───────────────────────────────────────────────────────

/**
 * One button per sportsbook for a play. Each opens the sportsbook with the
 * selection loaded into the bet slip when the book supplies that link; the
 * stake and confirmation always happen in the sportsbook, never here.
 */
function BetBar({ g }: { g: SlateGame }) {
  const options = g.betOptions ?? [];
  if (!options.length || !g.recommended || g.recommended.side === "NONE") return null;
  const team = g.recommended.side === "HOME" ? g.homeTeam : g.awayTeam;

  return (
    <div className="mb-3 rounded-xl border border-white/[0.08] bg-zinc-900/60 px-3 py-3 sm:px-4">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm text-zinc-300">
          Bet <span className="font-semibold text-zinc-100">{team}</span>
        </span>
        <span className="text-xs text-zinc-500">Opens the sportsbook. You set the stake and confirm there.</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const logo = bookLogoSrc(o.book);
          const action =
            o.level === "betslip" ? "Add to bet slip" :
            o.level === "home"    ? `Open ${o.bookName}` :
                                    "Open game";
          return (
            <div key={o.book} className="min-w-0">
              <a
                href={o.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={
                  o.level === "betslip"
                    ? `Opens ${o.bookName} with ${team} ${fmtSpread(o.line)} in the bet slip`
                    : `${o.bookName} did not supply a bet-slip link for this game, so this opens ${o.level === "home" ? "the sportsbook" : "the game page"} instead`
                }
                className="group flex items-center gap-3 rounded-lg border border-white/[0.1] bg-zinc-950/60 px-3 py-2.5 transition-colors hover:border-white/25 hover:bg-zinc-800/70"
              >
                {logo
                  ? <img src={logo} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />
                  : <span className="h-6 w-6 shrink-0 rounded bg-zinc-800" />}
                {/* Narrow screens: details on one line, action underneath.
                    Wider: action sits at the right edge. Nothing may overlap. */}
                <span className="flex min-w-0 flex-1 flex-col gap-1 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between min-[480px]:gap-3">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="whitespace-nowrap text-sm font-semibold text-zinc-100">{o.bookName}</span>
                    <span className="num whitespace-nowrap text-sm font-semibold text-zinc-100">{fmtSpread(o.line)}</span>
                    {o.price != null && <span className="num whitespace-nowrap text-xs text-zinc-400">({fmtML(o.price)})</span>}
                    {o.best && (
                      <span className="whitespace-nowrap rounded bg-emerald-400/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-emerald-300">
                        Best number
                      </span>
                    )}
                  </span>
                  <span className={`shrink-0 whitespace-nowrap text-xs font-medium ${o.level === "betslip" ? "text-zinc-300" : "text-zinc-500"} group-hover:text-zinc-100`}>
                    {action}
                  </span>
                </span>
              </a>
              {o.gameUrl && o.level === "betslip" && (
                <a
                  href={o.gameUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1.5 inline-block px-1 text-xs text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300"
                >
                  Slip didn&rsquo;t fill? Open the game at {o.bookName}
                </a>
              )}
            </div>
          );
        })}
      </div>
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

// ── Last-5 chips ──────────────────────────────────────────────────────────────

function L5Chips({ record }: { record: L5Record }) {
  const emoji = record.wins >= 4 ? "🔥" : record.losses >= 4 ? "🧊" : null;
  return (
    <div className="col-span-2 pt-2 mt-1 border-t border-white/[0.06]">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="flex gap-1">
          {record.games.map((g, i) => (
            <span
              key={i}
              title={`${g.result === "W" ? "W" : "L"} ${Math.abs(g.margin)} vs ${g.opponent} (${g.homeAway})`}
              className={`inline-flex items-center justify-center rounded w-5 h-5 text-[10px] font-bold cursor-default select-none ${
                g.result === "W"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
              }`}
            >
              {g.result}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-zinc-500 font-mono">
          {record.wins}-{record.losses}
        </span>
        <span className={`text-[11px] font-medium ${record.streak.startsWith("W") ? "text-emerald-400" : "text-rose-400"}`}>
          {record.streak}
        </span>
        {emoji && <span className="text-sm leading-none">{emoji}</span>}
      </div>
    </div>
  );
}

function TeamCard({ title, logo, t, l5, modelRecord }: { title: string; logo?: string | null; t?: TeamStats; l5?: L5Record; modelRecord?: ModelRecord }) {
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
          {l5 && <L5Chips record={l5} />}
          {modelRecord && (modelRecord.wins + modelRecord.losses) > 0 && (
            <div className="col-span-2 mt-1.5 pt-1.5 border-t border-white/5">
              <span className="text-[11px] text-zinc-500">Model ATS </span>
              <span className={`text-[11px] font-semibold font-mono ${
                modelRecord.wins > modelRecord.losses ? "text-emerald-400" :
                modelRecord.wins < modelRecord.losses ? "text-red-400" : "text-zinc-400"
              }`}>
                {modelRecord.wins}-{modelRecord.losses}
              </span>
              <span className="text-[11px] text-zinc-600 ml-1">
                ({Math.round((modelRecord.wins / (modelRecord.wins + modelRecord.losses)) * 100)}%)
              </span>
            </div>
          )}
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
          <span className="text-xs font-medium text-zinc-600">
            {label}
          </span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
      </td>
    </tr>
  );
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchTeamStats(teamId: string, league: LeagueId): Promise<TeamStats> {
  const res = await fetch(`/api/${league}/team-stats?teamId=${encodeURIComponent(teamId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`team-stats failed (${res.status})`);
  return res.json();
}

async function fetchTeamL5(teamId: string, league: LeagueId): Promise<{ id: string; record: L5Record }> {
  const res = await fetch(`/api/${league}/team-l5?teamId=${encodeURIComponent(teamId)}`);
  if (!res.ok) throw new Error(`team-l5 failed (${res.status})`);
  const record: L5Record = await res.json();
  return { id: teamId, record };
}

// ── Model pick record per team ────────────────────────────────────────────────

type ModelRecord = { wins: number; losses: number };
type ModelSummary = { wins: number; losses: number; pct: number | null; units?: number | null };

type ModelData = { teams: Record<string, ModelRecord>; summary: ModelSummary };

async function fetchModelData(league: LeagueId): Promise<ModelData> {
  const empty: ModelData = { teams: {}, summary: { wins: 0, losses: 0, pct: null } };
  try {
    const res = await fetch(`/api/${league}/analysis?all=1`, { cache: "no-store" });
    if (!res.ok) return empty;
    const json = await res.json();
    const map: Record<string, ModelRecord> = {};
    // Exclude backfilled dates from aggregate record
    const liveDays = (json.by_date ?? []).filter((d: any) => !d.backfilled);
    for (const day of liveDays) {
      for (const g of day.games ?? []) {
        if (!isPlay(g.signal)) continue;
        if (g.pick_result !== "WIN" && g.pick_result !== "LOSS") continue;
        const team = g.pick_side === "HOME" ? g.home_team : g.away_team;
        if (!map[team]) map[team] = { wins: 0, losses: 0 };
        if (g.pick_result === "WIN") map[team].wins++;
        else map[team].losses++;
      }
    }
    // Season record on plays comes straight from the API so the slate, the
    // results page and the stored season record always agree.
    const sm = json.summary ?? {};
    const wins = sm.wins ?? 0;
    const losses = sm.losses ?? 0;
    return {
      teams: map,
      summary: {
        wins,
        losses,
        pct: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null,
        units: typeof sm.units === "number" ? sm.units : null,
      },
    };
  } catch {
    return empty;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

type FilterMode = "ALL" | "PICKS" | "STRONG";

export default function SlateTable({ games, league }: { games: SlateGame[]; league: LeagueId }) {
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, TeamStats>>({});
  const [l5, setL5] = useState<Record<string, L5Record>>({});
  const [modelRec, setModelRec] = useState<Record<string, ModelRecord>>({});
  const [modelSummary, setModelSummary] = useState<ModelSummary>({ wins: 0, losses: 0, pct: null });
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("ALL");

  // Fetch season model records once on mount
  useEffect(() => {
    fetchModelData(league).then(({ teams, summary }) => {
      setModelRec(teams);
      setModelSummary(summary);
    });
  }, [league]);

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
    caution: upcoming.filter((g) => g.model.signal === "CAUTION").length,
  }), [upcoming]);

  const filtered = useMemo(() => {
    let arr = [...upcoming];
    if (filter === "PICKS")  arr = arr.filter((g) => isPlay(g.model.signal));
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
    filter === "ALL" ? filtered.findIndex((g) => !isPlay(g.model.signal)) : -1,
    [filtered, filter]
  );

  async function toggleRow(g: SlateGame) {
    setErr(null);
    const next = openGameId === g.gameId ? null : g.gameId;
    setOpenGameId(next);
    if (!next) return;

    // Fetch team stats (critical — show error if it fails)
    const wantStats = [g.homeTeamId, g.awayTeamId].filter((id) => !stats[id]);
    if (wantStats.length) {
      try {
        const results = await Promise.all(wantStats.map((id) => fetchTeamStats(id, league)));
        setStats((prev) => {
          const copy = { ...prev };
          for (const r of results) copy[r.teamId] = r;
          return copy;
        });
      } catch (e: any) {
        setErr(e?.message ?? "Failed to fetch team stats");
      }
    }

    // Fetch L5 records (non-critical — silently skip on failure)
    const wantL5 = [g.homeTeamId, g.awayTeamId].filter((id) => !l5[id]);
    if (wantL5.length) {
      Promise.allSettled(wantL5.map((id) => fetchTeamL5(id, league))).then((results) => {
        setL5((prev) => {
          const copy = { ...prev };
          for (const r of results) {
            if (r.status === "fulfilled") copy[r.value.id] = r.value.record;
          }
          return copy;
        });
      });
    }
  }

  const thCls = "px-3 py-2.5 text-xs font-medium text-zinc-500 text-left";
  const tdBase = "px-3 py-3";

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-900/30">

      {/* ── Summary bar ── */}
      <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <span className="text-zinc-300">
            <span className="num font-semibold text-zinc-100">{counts.games}</span> games
          </span>
          {counts.strong > 0 && (
            <span className="text-emerald-300"><span className="num font-semibold">{counts.strong}</span> strong</span>
          )}
          {counts.lean > 0 && (
            <span className="text-amber-300"><span className="num font-semibold">{counts.lean}</span> lean</span>
          )}
          {counts.caution > 0 && (
            <span
              className="cursor-help text-zinc-500"
              title="Edge of 8+ points or a 20+ point spread. The model is known to be off on big spreads, so these are not plays and are not tracked in results."
            >
              <span className="num font-semibold">{counts.caution}</span> caution
            </span>
          )}
          {modelSummary.pct !== null && (
            <span className="text-zinc-500 sm:border-l sm:border-white/10 sm:pl-4" title="Record on plays this season, graded at the price taken">
              Season{" "}
              <span className="num font-semibold text-zinc-200">{modelSummary.wins}-{modelSummary.losses}</span>
              {modelSummary.units != null && (
                <span className={`num ml-1.5 font-semibold ${modelSummary.units > 0 ? "text-emerald-400" : modelSummary.units < 0 ? "text-red-400" : "text-zinc-400"}`}>
                  {modelSummary.units > 0 ? "+" : ""}{modelSummary.units.toFixed(1)}u
                </span>
              )}
            </span>
          )}
          {err && <span className="text-xs text-rose-400">{err}</span>}
        </div>

        <div role="group" aria-label="Filter games" className="flex shrink-0 self-start rounded-lg border border-white/[0.08] bg-zinc-900/70 p-0.5 sm:self-auto">
          {(["ALL", "PICKS", "STRONG"] as FilterMode[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f ? "bg-white/[0.1] text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {f === "ALL" ? "All games" : f === "PICKS" ? "Plays" : "Strong only"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-sm">
          <colgroup>
            <col className="w-[84px]" />  {/* Time */}
            <col />                        {/* Game — fills remainder */}
            <col className="w-[92px]" />  {/* Market */}
            <col className="w-[80px]" />  {/* Model */}
            <col className="w-[76px]" />  {/* Edge */}
            <col className="w-[340px]" /> {/* Play */}
          </colgroup>

          <thead className="border-b border-white/8">
            <tr>
              <th className={thCls}>Time</th>
              <th className={thCls}>Game</th>
              <th className={`${thCls} !text-right`} title="Market spread for the home team">Market</th>
              <th className={`${thCls} !text-right`} title="Model spread for the home team">Model</th>
              <th className={`${thCls} !text-right`} title="Model minus market, in points">Edge</th>
              <th className={`${thCls} pl-6`}>Play</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.05]">
            {filtered.map((g, i) => {
              const open = openGameId === g.gameId;
              return (
                <Fragment key={g.gameId}>
                  {/* Group divider between picks and other games */}
                  {i === firstNoneIdx && firstNoneIdx > 0 && (
                    <SectionDivider label="No play" />
                  )}

                  <tr
                    className={`cursor-pointer transition-colors hover:bg-white/[0.025] ${rowTint(g.model.signal, g.overrides?.skip)}`}
                    onClick={() => toggleRow(g)}
                  >
                    {/* Time */}
                    <td className={`${tdBase} whitespace-nowrap align-middle ${railClass(g.model.signal, g.overrides?.skip)}`}>
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
                    <td className={`${tdBase} align-middle text-right font-mono text-sm text-zinc-400`}>
                      <div className="flex items-center justify-end gap-1">
                        {fmtSpread(g.consensus?.spread)}
                        <LineMovement current={g.consensus?.spread} opening={g.openingSpread} edge={g.model?.edge} />
                      </div>
                    </td>

                    {/* Model */}
                    <td className={`${tdBase} align-middle text-right font-mono text-sm text-zinc-200`}>
                      {fmtSpread(g.model?.modelSpread)}
                    </td>

                    {/* Edge */}
                    <td className={`${tdBase} align-middle text-right`}>
                      <EdgeCell edge={g.model?.edge} signal={g.model?.signal} />
                    </td>

                    {/* Play */}
                    <td className={`${tdBase} pl-6 align-middle`}>
                      <PickText
                        signal={g.model.signal}
                        side={g.recommended?.side}
                        line={g.recommended?.line ?? null}
                        neutralSite={g.neutralSite}
                        cautionNote={g.model.cautionNote}
                        teamName={g.recommended?.side === "HOME" ? g.homeTeam : g.recommended?.side === "AWAY" ? g.awayTeam : undefined}
                      />
                    </td>
                  </tr>

                  {/* Expand row */}
                  {open && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 bg-black/20 border-b border-white/[0.05]">
                        <BetBar g={g} />
                        <GameInfoBar g={g} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <TeamCard title={g.awayTeam} logo={g.awayLogo} t={stats[g.awayTeamId]} l5={l5[g.awayTeamId]} modelRecord={modelRec[g.awayTeam]} />
                          <TeamCard title={g.homeTeam} logo={g.homeLogo} t={stats[g.homeTeamId]} l5={l5[g.homeTeamId]} modelRecord={modelRec[g.homeTeam]} />
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
      <div className="md:hidden py-3 px-3 space-y-2">
        {filtered.map((g, i) => {
          const open = openGameId === g.gameId;
          const preferred = modelPrefersSide(g.model.edge);
          const hasPick = isPlay(g.model.signal);

          const preferredNameColor = "font-semibold text-zinc-100";

          return (
            <div key={g.gameId}>
              {/* Mobile section divider */}
              {i === firstNoneIdx && firstNoneIdx > 0 && (
                <div className="flex items-center gap-3 py-2">
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="text-xs font-medium text-zinc-600">No play</span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>
              )}

              {/* Card — wraps both the summary row and the expanded panel */}
              <div className={`overflow-hidden transition-all ${mobileCardClass(g.model.signal, g.overrides?.skip)}`}>
                <div
                  className="cursor-pointer px-4 py-3"
                  onClick={() => toggleRow(g)}
                >
                  {/* Time + pick + chevron */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="whitespace-nowrap text-xs text-zinc-500">{fmtTime(g.startTimeISO)}</span>
                    <div className="flex items-center gap-2">
                      <PickText signal={g.model.signal} side={g.recommended?.side} line={g.recommended?.line ?? null} neutralSite={g.neutralSite} cautionNote={g.model.cautionNote} compact />
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
                            preferred === team.side && hasPick ? preferredNameColor :
                            hasPick && preferred ? "text-zinc-500" : "text-zinc-300"
                          }`} title={team.name}>{team.name}</span>
                        </div>
                      </React.Fragment>
                    ))}
                    {g.neutralSite && <div className="mt-1"><NeutralBadge /></div>}
                    {g.overrides?.forceHome && <div className="mt-1"><OverrideHomeBadge /></div>}
                    {g.overrides?.skip && <div className="mt-1"><SkipBadge reason={g.overrides.reason} /></div>}
                  </div>

                  {/* Mkt / Model / Edge */}
                  <div className="flex items-baseline gap-4 text-xs text-zinc-500">
                    <span>Market <span className="text-zinc-400 font-mono">{fmtSpread(g.consensus?.spread)}</span> <LineMovement current={g.consensus?.spread} opening={g.openingSpread} edge={g.model?.edge} /></span>
                    <span>Model <span className="font-mono text-zinc-200">{fmtSpread(g.model?.modelSpread)}</span></span>
                    <span>Edge <EdgeCell edge={g.model?.edge} signal={g.model?.signal} /></span>
                  </div>
                </div>

                {open && (
                  <div className="px-2.5 py-3 bg-black/20 border-t border-white/[0.06] min-[400px]:px-4 min-[400px]:py-4">
                    <BetBar g={g} />
                    <GameInfoBar g={g} />
                    <div className="grid gap-3">
                      <TeamCard title={g.awayTeam} logo={g.awayLogo} t={stats[g.awayTeamId]} l5={l5[g.awayTeamId]} modelRecord={modelRec[g.awayTeam]} />
                      <TeamCard title={g.homeTeam} logo={g.homeLogo} t={stats[g.homeTeamId]} l5={l5[g.homeTeamId]} modelRecord={modelRec[g.homeTeam]} />
                    </div>
                  </div>
                )}
              </div>
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
