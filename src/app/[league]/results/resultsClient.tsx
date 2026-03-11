"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { LeagueId } from "@/lib/leagues";

// ---- types ----
type GameRow = {
  date: string;
  home_team: string;
  away_team: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  neutral_site: boolean;
  opening_spread: number | null;
  opening_book: string | null;
  closing_spread: number | null;
  clv: number | null;
  model_spread: number | null;
  edge: number | null;
  signal: string;
  pick_side: string;
  home_score: number | null;
  away_score: number | null;
  actual_spread: number | null;
  winner: "HOME" | "AWAY" | "TIE" | null;
  completed: boolean;
  pick_result: "WIN" | "LOSS" | "PUSH" | "NO_PICK" | "PENDING";
  picked_at?: string | null; // ISO timestamp — present for intraday picks
  // Override flags
  skipped?: boolean;
  forced_home?: boolean;
  override_reason?: string;
};

type DayResult = {
  date: string;
  snapshot_available: boolean;
  backfilled?: boolean;     // true for dates before live tracking started (Feb 24 – Mar 1)
  results_available: boolean;
  results_live?: boolean;   // true when scores come from live ESPN fetch (no results file yet)
  in_progress?: number;     // count of games currently in progress
  total_games: number;
  picks_made: number;
  strong_picks: number;
  lean_picks: number;
  record: string;
  strong_record: string;
  win_pct: number | null;
  games: GameRow[];
};

type AnalysisResponse = {
  dates_analyzed: string[];
  summary: {
    total_picks: number;
    decided: number;
    wins: number;
    losses: number;
    win_pct: number | null;
  };
  by_date: DayResult[];
};

// ---- helpers ----
function espnLogoUrl(id: string | null, _league: LeagueId) {
  if (!id) return null;
  // ESPN serves both NCAAM and NCAAW team logos at the ncaa/500/ CDN path.
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
}

function spreadLabel(n: number | null) {
  if (n === null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Was the model directionally correct about which side covers?
 * edge < 0 → model liked HOME; edge > 0 → model liked AWAY.
 * homeCovered = (actualSpread - openingSpread) < 0 (home-spread convention).
 */
function modelDirectionCorrect(g: GameRow): boolean | null {
  if (!g.completed) return null;
  if (g.edge === null || g.edge === 0) return null;
  if (g.actual_spread === null || g.opening_spread === null) return null;
  const margin = g.actual_spread - g.opening_spread;
  if (Math.abs(margin) < 0.01) return null; // push
  const homeCovered = margin < 0;
  const modelLikedHome = g.edge < 0;
  return modelLikedHome === homeCovered;
}

// ---- derived stats ----
type CalibrationBucket = {
  label: string;
  sublabel: string;
  games: number;
  dirCorrect: number;
  wins: number;
  losses: number;
};

// $100 flat-bet ROI at standard -110 odds
// WIN: profit = $100 / 1.10 = $90.91; LOSS: -$100
const BET_SIZE = 100;
const WIN_PROFIT = BET_SIZE / 1.1; // ≈ $90.91

function computeStats(byDate: DayResult[]) {
  const allGames = byDate.flatMap((d) => d.games);
  const completed = allGames.filter((g) => g.completed);

  let dirTotal = 0, dirCorrect = 0;
  for (const g of completed) {
    const dc = modelDirectionCorrect(g);
    if (dc !== null) { dirTotal++; if (dc) dirCorrect++; }
  }

  const errors = completed
    .filter((g) => g.model_spread !== null && g.actual_spread !== null)
    .map((g) => Math.abs(g.model_spread! - g.actual_spread!));
  const avgError = errors.length > 0
    ? errors.reduce((a, b) => a + b, 0) / errors.length
    : null;

  // ROI: flat $100 bet on every LEAN/STRONG pick
  let roi: number | null = null;
  let roiGames = 0;
  for (const g of allGames) {
    if (g.pick_result === "WIN")  { roi = (roi ?? 0) + WIN_PROFIT; roiGames++; }
    if (g.pick_result === "LOSS") { roi = (roi ?? 0) - BET_SIZE;  roiGames++; }
  }

  // Average CLV across games where we have both a pick and a CLV
  const clvGames = allGames.filter(
    (g) => g.signal !== "NONE" && g.clv !== null
  );
  const avgClv = clvGames.length > 0
    ? clvGames.reduce((sum, g) => sum + g.clv!, 0) / clvGames.length
    : null;

  const buckets: CalibrationBucket[] = [
    { label: "0–1",    sublabel: "|edge| < 1",       games: 0, dirCorrect: 0, wins: 0, losses: 0 },
    { label: "1–2",    sublabel: "1 ≤ |edge| < 2",   games: 0, dirCorrect: 0, wins: 0, losses: 0 },
    { label: "2–3",    sublabel: "2 ≤ |edge| < 3",   games: 0, dirCorrect: 0, wins: 0, losses: 0 },
    { label: "LEAN",   sublabel: "3 ≤ |edge| < 5",   games: 0, dirCorrect: 0, wins: 0, losses: 0 },
    { label: "STRONG", sublabel: "|edge| ≥ 5",        games: 0, dirCorrect: 0, wins: 0, losses: 0 },
  ];
  for (const g of completed) {
    if (g.edge === null) continue;
    const abs = Math.abs(g.edge);
    const bi = abs >= 5 ? 4 : abs >= 3 ? 3 : abs >= 2 ? 2 : abs >= 1 ? 1 : 0;
    const b = buckets[bi];
    // Use modelDirectionCorrect for all buckets so no-pick rows show
    // simulated ATS (what would have happened if we'd bet the model side).
    // For LEAN/STRONG this is equivalent to pick_result WIN/LOSS.
    const dc = modelDirectionCorrect(g);
    if (dc !== null) {
      b.games++;
      if (dc) { b.dirCorrect++; b.wins++; } else { b.losses++; }
    }
  }

  return { dirTotal, dirCorrect, avgError, roi, roiGames, avgClv, clvGames: clvGames.length, buckets };
}

// ---- UI atoms ----
function TeamLogo({ id, name, league, size = 20 }: { id: string | null; name: string; league: LeagueId; size?: number }) {
  const src = espnLogoUrl(id, league);
  if (!src) return <span className="inline-block bg-zinc-700 rounded-full" style={{ width: size, height: size }} />;
  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      className="object-contain"
      unoptimized
    />
  );
}

function PickResultBadge({ result, inProgress }: { result: GameRow["pick_result"]; inProgress?: boolean }) {
  if (result === "NO_PICK") return null;
  const base = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold";
  if (result === "WIN")     return <span className={`${base} bg-emerald-500/20 text-emerald-400`}>WIN</span>;
  if (result === "LOSS")    return <span className={`${base} bg-red-500/20 text-red-400`}>LOSS</span>;
  if (result === "PUSH")    return <span className={`${base} bg-zinc-500/20 text-zinc-400`}>PUSH</span>;
  if (result === "PENDING" && inProgress) return (
    <span className={`${base} bg-blue-500/15 text-blue-400`}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      LIVE
    </span>
  );
  if (result === "PENDING") return <span className={`${base} bg-amber-500/20 text-amber-400`}>PENDING</span>;
  return null;
}

function DirBadge({ g }: { g: GameRow }) {
  const dc = modelDirectionCorrect(g);
  if (dc === null) return <span className="text-zinc-700">—</span>;
  return dc
    ? <span className="text-emerald-500 text-xs font-semibold">✓</span>
    : <span className="text-red-500   text-xs font-semibold">✗</span>;
}

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

function OverrideHomeBadge() {
  return (
    <span
      title="Override: neutral site forced to home game (HCA applied)"
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-orange-500/15 text-orange-400 border border-orange-500/20"
    >
      🏠 HOME OVERRIDE
    </span>
  );
}

function SkipBadge({ reason }: { reason?: string }) {
  return (
    <span
      title={reason ?? "Game skipped — excluded from picks and results"}
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/20"
    >
      ⊘ SKIPPED
    </span>
  );
}

function SignalBadge({ signal, pickSide }: { signal: string; pickSide: string }) {
  if (signal === "NONE") return <span className="text-zinc-600 text-xs">—</span>;
  const color = signal === "STRONG" ? "text-emerald-400" : "text-amber-400";
  return <span className={`text-xs font-semibold whitespace-nowrap ${color}`}>{signal} {pickSide}</span>;
}

function IntradayBadge({ pickedAt }: { pickedAt: string }) {
  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(pickedAt));

  return (
    <span
      title={`Intraday pick detected at ${timeStr} ET`}
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-violet-500/15 text-violet-400 border border-violet-500/20"
    >
      {timeStr}
    </span>
  );
}

function EdgeLabel({ edge }: { edge: number | null }) {
  if (edge === null) return <>—</>;
  const color = Math.abs(edge) >= 5 ? "text-emerald-400"
    : Math.abs(edge) >= 3 ? "text-amber-400" : "text-zinc-500";
  return <span className={`font-mono text-xs ${color}`}>{edge > 0 ? `+${edge}` : edge}</span>;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 border border-white/10 px-4 py-3 min-w-[130px]">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="text-lg font-bold text-zinc-100">{value}</div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
  );
}

function EdgeCalibrationTable({ buckets }: { buckets: CalibrationBucket[] }) {
  if (!buckets.some((b) => b.games > 0 || b.wins > 0 || b.losses > 0)) return null;
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <div className="px-4 py-2.5 bg-zinc-900 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-xs font-semibold text-zinc-300">Edge Calibration</span>
          <span className="text-xs text-zinc-500 ml-2">direction accuracy &amp; simulated ATS by edge size</span>
        </div>
        <div className="text-[11px] text-zinc-600 font-mono">
          break-even @ <span className="text-zinc-400 font-semibold">52.4%</span> at −110
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10 text-zinc-500">
            <th className="px-4 py-2 text-left  font-medium">Bucket</th>
            <th className="px-3 py-2 text-right font-medium">Games</th>
            <th className="px-3 py-2 text-right font-medium">Direction %</th>
            <th className="px-3 py-2 text-right font-medium">ATS Record</th>
            <th className="px-3 py-2 text-right font-medium">ATS %</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => {
            const dirPct  = b.games > 0            ? Math.round((b.dirCorrect / b.games) * 100) : null;
            const atsPct  = b.wins + b.losses > 0  ? Math.round((b.wins / (b.wins + b.losses)) * 100) : null;
            const dirColor = dirPct === null ? "text-zinc-600" : dirPct >= 60 ? "text-emerald-400" : dirPct >= 52.4 ? "text-amber-400" : "text-red-400";
            const atsColor = atsPct === null ? "text-zinc-600" : atsPct >= 60 ? "text-emerald-400" : atsPct >= 52.4 ? "text-amber-400" : "text-red-400";
            const lc = b.label === "STRONG" ? "text-emerald-400" : b.label === "LEAN" ? "text-amber-400" : "text-zinc-400";
            // Add a slightly thicker divider before LEAN to separate no-pick zone from picks
            const topBorder = b.label === "LEAN" ? "border-t border-white/10" : "";
            return (
              <tr key={b.label} className={`border-b border-white/5 bg-zinc-900/30 ${topBorder}`}>
                <td className="px-4 py-2.5">
                  <span className={`font-semibold ${lc}`}>{b.label}</span>
                  <span className="text-zinc-600 ml-1.5 text-[11px]">{b.sublabel}</span>
                </td>
                <td className="px-3 py-2.5 text-right text-zinc-400">
                  {b.games > 0 ? b.games : <span className="text-zinc-700">—</span>}
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold ${dirColor}`}>
                  {dirPct !== null ? <>{dirPct}% <span className="text-zinc-600 font-normal">({b.dirCorrect}/{b.games})</span></> : "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-zinc-400 font-mono">
                  {b.wins + b.losses > 0 ? `${b.wins}-${b.losses}` : "—"}
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold ${atsColor}`}>
                  {atsPct !== null ? `${atsPct}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Mobile game card
function GameCard({ g, league }: { g: GameRow; league: LeagueId }) {
  const hasPick = g.signal !== "NONE";
  const dc = modelDirectionCorrect(g);
  const rowBg = hasPick
    ? g.pick_result === "WIN"
      ? "border border-emerald-500/40 bg-emerald-500/[0.11] shadow-[0_0_22px_-4px_rgba(52,211,153,0.4)]"
    : g.pick_result === "LOSS"
      ? "border border-red-500/40 bg-red-500/[0.10] shadow-[0_0_22px_-4px_rgba(239,68,68,0.35)]"
    : "border border-zinc-700/40 bg-zinc-900/50"
    : "border border-white/[0.04] bg-zinc-900/20";

  return (
    <div className={`rounded-xl px-3 py-2.5 ${rowBg}`}>
      {/* teams row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex flex-col gap-1">
          {/* away */}
          <div className="flex items-center gap-1.5">
            <TeamLogo id={g.away_espnTeamId} name={g.away_team} league={league} size={16} />
            <span className="text-xs text-zinc-300">{g.away_team}</span>
            {g.away_score !== null && (
              <span className={`text-xs font-bold ml-1 ${g.winner === "AWAY" ? "text-zinc-100" : "text-zinc-500"}`}>
                {g.away_score}
              </span>
            )}
          </div>
          {/* home */}
          <div className="flex items-center gap-1.5">
            <TeamLogo id={g.home_espnTeamId} name={g.home_team} league={league} size={16} />
            <span className="text-xs text-zinc-300">{g.home_team}</span>
            {g.home_score !== null && (
              <span className={`text-xs font-bold ml-1 ${g.winner === "HOME" ? "text-zinc-100" : "text-zinc-500"}`}>
                {g.home_score}
              </span>
            )}
          </div>
        </div>
        {/* result badge */}
        <div className="flex flex-col items-end gap-1">
          <PickResultBadge result={g.pick_result} inProgress={!g.completed && ((g.home_score ?? 0) > 0 || (g.away_score ?? 0) > 0)} />
          {dc !== null && (
            <span className="text-[10px] text-zinc-500">
              Dir {dc ? <span className="text-emerald-500">✓</span> : <span className="text-red-500">✗</span>}
            </span>
          )}
        </div>
      </div>
      {/* neutral site / override badges */}
      {g.neutral_site && <div className="mb-1"><NeutralBadge /></div>}
      {g.forced_home && <div className="mb-1"><OverrideHomeBadge /></div>}
      {g.skipped && <div className="mb-1"><SkipBadge reason={g.override_reason} /></div>}
      {/* stats row */}
      <div className="flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
        <span>Line <span className="text-zinc-300 font-mono">{spreadLabel(g.opening_spread)}</span></span>
        <span>Model <span className="text-zinc-300 font-mono">{spreadLabel(g.model_spread)}</span></span>
        <span>Edge <EdgeLabel edge={g.edge} /></span>
        {g.actual_spread !== null && (
          <span>Act <span className="text-zinc-400 font-mono">{spreadLabel(g.actual_spread)}</span></span>
        )}
        {g.clv !== null && (
          <span>CLV <span className={`font-mono font-semibold ${g.clv >= 0 ? "text-emerald-400" : "text-red-400"}`}>{g.clv >= 0 ? `+${g.clv.toFixed(1)}` : g.clv.toFixed(1)}</span></span>
        )}
        {hasPick && (
          <SignalBadge signal={g.signal} pickSide={g.pick_side} />
        )}
        {g.picked_at && <IntradayBadge pickedAt={g.picked_at} />}
      </div>
    </div>
  );
}

// ---- filter helpers ----
type Filter = "today" | "yesterday" | "7d" | "30d" | "season";

const FILTER_LABELS: Record<Filter, string> = {
  today:     "Today",
  yesterday: "Yesterday",
  "7d":      "Last 7 Days",
  "30d":     "Last 30 Days",
  season:    "Full Season",
};

function etDateString(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(d)
    .slice(0, 10);
}

function filterToApiUrl(f: Filter, league: LeagueId): string {
  switch (f) {
    case "today":     return `/api/${league}/analysis?date=${etDateString(0)}`;
    case "yesterday": return `/api/${league}/analysis?date=${etDateString(1)}`;
    case "7d":        return `/api/${league}/analysis`;                         // default = last 7 available
    case "30d":       return `/api/${league}/analysis?from=${etDateString(30)}&to=${etDateString()}`;
    case "season":    return `/api/${league}/analysis?all=1`;
  }
}

// ---- main component ----
export default function ResultsClient({ league }: { league: LeagueId }) {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("7d");
  const [showBackfilled, setShowBackfilled] = useState(false);

  async function load(f: Filter) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(filterToApiUrl(f, league), { cache: "no-store" });
      if (!res.ok) {
        // "Today" with no opener yet is expected — show a friendly message
        if (f === "today" && res.status === 404) {
          setData(null);
          setErr("no-opener-today");
          return;
        }
        throw new Error(`API error ${res.status}`);
      }
      const json = (await res.json()) as AnalysisResponse;
      setData(json);
      // auto-expand most recent date
      if (json.by_date.length > 0) {
        setExpandedDate(json.by_date[json.by_date.length - 1].date);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load results");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(filter); }, [filter]);

  // Auto-refresh every 60 seconds when any day has live results
  useEffect(() => {
    const hasLive = data?.by_date.some((d) => d.results_live);
    if (!hasLive) return;
    const interval = setInterval(() => load(filter), 60_000);
    return () => clearInterval(interval);
  }, [data, filter]);

  if (loading) return <div className="text-zinc-400 text-sm py-8">Loading results…</div>;
  if (err === "no-opener-today") return (
    <div className="text-zinc-500 text-sm py-8">
      No opener data for today yet — check back after 11am ET when the odds snapshot runs.{" "}
      <button onClick={() => load(filter)} className="text-zinc-300 underline">Refresh</button>
    </div>
  );
  if (err)     return <div className="text-red-400 text-sm py-8">{err}</div>;
  if (!data)   return null;

  const { summary, by_date } = data;
  const visibleDates = showBackfilled ? by_date : by_date.filter((d) => !d.backfilled);
  const sorted = [...visibleDates].reverse();
  const { dirTotal, dirCorrect, avgError, roi, roiGames, avgClv, clvGames, buckets } = computeStats(visibleDates);
  const backfilledCount = by_date.filter((d) => d.backfilled).length;

  const sortGames = (games: GameRow[]) =>
    games.slice().sort((a, b) => {
      const ap = a.signal !== "NONE" ? 1 : 0;
      const bp = b.signal !== "NONE" ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0);
    });

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <div className="text-xs text-zinc-400">Model Results</div>
          <div className="text-sm text-zinc-500">
            {visibleDates.length} day{visibleDates.length !== 1 ? "s" : ""} · {FILTER_LABELS[filter]}
            {!showBackfilled && backfilledCount > 0 && (
              <span className="ml-1 text-zinc-600">
                ({backfilledCount} backfilled hidden)
              </span>
            )}
          </div>
        </div>

        {/* filter tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-white/10 rounded-lg p-1">
          {(["today", "yesterday", "7d", "30d", "season"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        {backfilledCount > 0 && (
          <button
            onClick={() => setShowBackfilled((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium self-start sm:self-auto transition-colors ${
              showBackfilled
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30"
                : "bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700"
            }`}
            title={showBackfilled ? "Hide backfilled dates (Feb 24–Mar 1)" : "Show backfilled dates (Feb 24–Mar 1)"}
          >
            {showBackfilled ? "Hide backfilled" : "Show backfilled"}
          </button>
        )}

        <button
          onClick={() => load(filter)}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 self-start sm:self-auto"
        >
          Refresh
        </button>
      </div>

      {/* summary stat cards */}
      {(summary.total_picks > 0 || dirTotal > 0) && (
        <div className="flex flex-wrap gap-3">
          <StatCard
            label="ATS Record"
            value={summary.decided > 0 ? `${summary.wins}-${summary.losses}` : "—"}
            sub={summary.decided > 0 && summary.win_pct !== null
              ? `${summary.win_pct}% (${summary.decided} decided)`
              : `${summary.total_picks} picks`}
          />
          {dirTotal > 0 && (
            <StatCard
              label="Direction Acc."
              value={`${Math.round((dirCorrect / dirTotal) * 100)}%`}
              sub={`${dirCorrect}/${dirTotal} all completed games`}
            />
          )}
          {avgError !== null && (
            <StatCard
              label="Avg Model Error"
              value={`±${avgError.toFixed(1)} pts`}
              sub="vs. actual spread"
            />
          )}
          {roi !== null && (
            <StatCard
              label="Flat-Bet ROI"
              value={`${roi >= 0 ? "+" : ""}$${roi.toFixed(0)}`}
              sub={`on ${roiGames} decided picks ($100/game)`}
            />
          )}
          {avgClv !== null && (
            <StatCard
              label="Avg CLV"
              value={`${avgClv >= 0 ? "+" : ""}${avgClv.toFixed(1)} pts`}
              sub={`${clvGames} pick${clvGames !== 1 ? "s" : ""} vs. closing line`}
            />
          )}
          <StatCard
            label="Total Picks"
            value={String(summary.total_picks)}
            sub={`${summary.decided} decided`}
          />
        </div>
      )}

      {/* edge calibration */}
      <EdgeCalibrationTable buckets={buckets} />

      {by_date.length === 0 && (
        <div className="text-zinc-500 text-sm">No snapshot data yet. Run the odds opener workflow to start tracking.</div>
      )}

      {/* per-day sections */}
      {sorted.map((day) => (
        <div key={day.date} className="rounded-xl border border-white/10 overflow-hidden">
          {/* day header — toggle */}
          <button
            className="w-full flex items-center justify-between px-4 py-3 bg-zinc-900 hover:bg-zinc-800 transition-colors"
            onClick={() => setExpandedDate(expandedDate === day.date ? null : day.date)}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold text-zinc-100">{day.date}</span>
              <span className="text-xs text-zinc-500">
                {day.total_games} games · {day.picks_made} pick{day.picks_made !== 1 ? "s" : ""}
                {day.strong_picks > 0 && ` (${day.strong_picks} STRONG)`}
              </span>
              {day.results_live && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  {day.in_progress ? `${day.in_progress} LIVE` : "LIVE"}
                </span>
              )}
              {day.backfilled && (
                <span className="text-xs text-zinc-600 font-medium">backfilled</span>
              )}
              {!day.results_available && !day.results_live && (
                <span className="text-xs text-amber-400/70">results pending</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {day.picks_made > 0 && (
                <span className="text-xs font-medium text-zinc-300">
                  {day.record === "pending" ? "—" : day.record} ATS
                  {day.win_pct !== null ? ` (${day.win_pct}%)` : ""}
                </span>
              )}
              <span className="text-zinc-500 text-xs">{expandedDate === day.date ? "▲" : "▼"}</span>
            </div>
          </button>

          {expandedDate === day.date && (
            <>
              {/* ---- MOBILE: card list ---- */}
              <div className="md:hidden divide-y divide-white/5 px-3 py-2 space-y-1.5">
                {sortGames(day.games).map((g, i) => <GameCard key={i} g={g} league={league} />)}
              </div>

              {/* ---- DESKTOP: table ---- */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-500">
                      <th className="px-4 py-2 text-left  font-medium">Matchup</th>
                      <th className="px-3 py-2 text-right font-medium">Opening</th>
                      <th className="px-3 py-2 text-right font-medium">Model</th>
                      <th className="px-3 py-2 text-right font-medium">Edge</th>
                      <th className="px-3 py-2 text-left  font-medium">Pick</th>
                      <th className="px-3 py-2 text-right font-medium">Score</th>
                      <th className="px-3 py-2 text-right font-medium">Actual</th>
                      <th className="px-3 py-2 text-right font-medium">CLV</th>
                      <th className="px-3 py-2 text-center font-medium">Dir</th>
                      <th className="px-3 py-2 text-left  font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortGames(day.games).map((g, i) => {
                      const hasPick = g.signal !== "NONE";
                      return (
                        <tr
                          key={i}
                          className={`border-b border-white/5 ${
                            hasPick
                              ? g.pick_result === "WIN"  ? "bg-emerald-950/30"
                              : g.pick_result === "LOSS" ? "bg-red-950/30"
                              : "bg-zinc-900/50"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-2">
                            {/* away */}
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <TeamLogo id={g.away_espnTeamId} name={g.away_team} league={league} size={16} />
                              <span className="text-zinc-400">{g.away_team}</span>
                            </div>
                            {/* home */}
                            <div className="flex items-center gap-1.5">
                              <TeamLogo id={g.home_espnTeamId} name={g.home_team} league={league} size={16} />
                              <span className="text-zinc-200">{g.home_team}</span>
                            </div>
                            {g.neutral_site && (
                              <div className="mt-0.5"><NeutralBadge /></div>
                            )}
                            {g.forced_home && (
                              <div className="mt-0.5"><OverrideHomeBadge /></div>
                            )}
                            {g.skipped && (
                              <div className="mt-0.5"><SkipBadge reason={g.override_reason} /></div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-300 align-middle">
                            {spreadLabel(g.opening_spread)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-300 align-middle">
                            {spreadLabel(g.model_spread)}
                          </td>
                          <td className="px-3 py-2 text-right align-middle">
                            <EdgeLabel edge={g.edge} />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="flex items-center gap-1">
                              <SignalBadge signal={g.signal} pickSide={g.pick_side} />
                              {g.picked_at && <IntradayBadge pickedAt={g.picked_at} />}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono align-middle">
                            {g.away_score !== null && g.home_score !== null ? (
                              <div className="text-right leading-snug">
                                <div className={g.winner === "AWAY" ? "text-zinc-100 font-semibold" : "text-zinc-500"}>{g.away_score}</div>
                                <div className={g.winner === "HOME" ? "text-zinc-100 font-semibold" : "text-zinc-500"}>{g.home_score}</div>
                                {!g.completed && ((g.home_score ?? 0) > 0 || (g.away_score ?? 0) > 0) && (
                                  <div className="flex items-center justify-end gap-1 mt-0.5">
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                    <span className="text-[10px] text-blue-400 font-normal">live</span>
                                  </div>
                                )}
                              </div>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-400 align-middle">
                            {spreadLabel(g.actual_spread)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono align-middle">
                            {g.clv !== null ? (
                              <span className={`text-xs font-semibold ${g.clv >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {g.clv >= 0 ? `+${g.clv.toFixed(1)}` : g.clv.toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-zinc-700">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center align-middle">
                            <DirBadge g={g} />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <PickResultBadge result={g.pick_result} inProgress={!g.completed && ((g.home_score ?? 0) > 0 || (g.away_score ?? 0) > 0)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
