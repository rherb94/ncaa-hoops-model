"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// ---- types ----
type GameRow = {
  date: string;
  home_team: string;
  away_team: string;
  home_espnTeamId: string | null;
  away_espnTeamId: string | null;
  opening_spread: number | null;
  opening_book: string | null;
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
};

type DayResult = {
  date: string;
  snapshot_available: boolean;
  results_available: boolean;
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
function espnLogoUrl(id: string | null) {
  if (!id) return null;
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

  return { dirTotal, dirCorrect, avgError, buckets };
}

// ---- UI atoms ----
function TeamLogo({ id, name, size = 20 }: { id: string | null; name: string; size?: number }) {
  const src = espnLogoUrl(id);
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

function PickResultBadge({ result }: { result: GameRow["pick_result"] }) {
  if (result === "NO_PICK") return null;
  const base = "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold";
  if (result === "WIN")     return <span className={`${base} bg-emerald-500/20 text-emerald-400`}>WIN</span>;
  if (result === "LOSS")    return <span className={`${base} bg-red-500/20 text-red-400`}>LOSS</span>;
  if (result === "PUSH")    return <span className={`${base} bg-zinc-500/20 text-zinc-400`}>PUSH</span>;
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

function SignalBadge({ signal, pickSide }: { signal: string; pickSide: string }) {
  if (signal === "NONE") return <span className="text-zinc-600 text-xs">—</span>;
  const color = signal === "STRONG" ? "text-emerald-400" : "text-amber-400";
  return <span className={`text-xs font-semibold ${color}`}>{signal} {pickSide}</span>;
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
      <div className="px-4 py-2.5 bg-zinc-900 border-b border-white/10">
        <span className="text-xs font-semibold text-zinc-300">Edge Calibration</span>
        <span className="text-xs text-zinc-500 ml-2">direction accuracy &amp; simulated ATS by edge size</span>
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
            const dirColor = dirPct === null ? "text-zinc-600" : dirPct >= 60 ? "text-emerald-400" : dirPct >= 50 ? "text-amber-400" : "text-red-400";
            const atsColor = atsPct === null ? "text-zinc-600" : atsPct >= 60 ? "text-emerald-400" : atsPct >= 50 ? "text-amber-400" : "text-red-400";
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
function GameCard({ g }: { g: GameRow }) {
  const hasPick = g.signal !== "NONE";
  const dc = modelDirectionCorrect(g);
  const rowBg = hasPick
    ? g.pick_result === "WIN"  ? "border-l-2 border-emerald-500 bg-emerald-950/20"
    : g.pick_result === "LOSS" ? "border-l-2 border-red-500 bg-red-950/20"
    : "border-l-2 border-zinc-700 bg-zinc-900/50"
    : "bg-zinc-900/20";

  return (
    <div className={`rounded-lg px-3 py-2.5 ${rowBg}`}>
      {/* teams row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex flex-col gap-1">
          {/* away */}
          <div className="flex items-center gap-1.5">
            <TeamLogo id={g.away_espnTeamId} name={g.away_team} size={16} />
            <span className="text-xs text-zinc-300">{g.away_team}</span>
            {g.away_score !== null && (
              <span className={`text-xs font-bold ml-1 ${g.winner === "AWAY" ? "text-zinc-100" : "text-zinc-500"}`}>
                {g.away_score}
              </span>
            )}
          </div>
          {/* home */}
          <div className="flex items-center gap-1.5">
            <TeamLogo id={g.home_espnTeamId} name={g.home_team} size={16} />
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
          <PickResultBadge result={g.pick_result} />
          {dc !== null && (
            <span className="text-[10px] text-zinc-500">
              Dir {dc ? <span className="text-emerald-500">✓</span> : <span className="text-red-500">✗</span>}
            </span>
          )}
        </div>
      </div>
      {/* stats row */}
      <div className="flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
        <span>Line <span className="text-zinc-300 font-mono">{spreadLabel(g.opening_spread)}</span></span>
        <span>Model <span className="text-zinc-300 font-mono">{spreadLabel(g.model_spread)}</span></span>
        <span>Edge <EdgeLabel edge={g.edge} /></span>
        {g.actual_spread !== null && (
          <span>Act <span className="text-zinc-400 font-mono">{spreadLabel(g.actual_spread)}</span></span>
        )}
        {hasPick && (
          <SignalBadge signal={g.signal} pickSide={g.pick_side} />
        )}
      </div>
    </div>
  );
}

// ---- filter helpers ----
type Filter = "yesterday" | "7d" | "30d" | "season";

const FILTER_LABELS: Record<Filter, string> = {
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

function filterToApiUrl(f: Filter): string {
  switch (f) {
    case "yesterday": return `/api/analysis?date=${etDateString(1)}`;
    case "7d":        return `/api/analysis`;                         // default = last 7 available
    case "30d":       return `/api/analysis?from=${etDateString(30)}&to=${etDateString()}`;
    case "season":    return `/api/analysis?all=1`;
  }
}

// ---- main component ----
export default function ResultsClient() {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("7d");

  async function load(f: Filter) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(filterToApiUrl(f), { cache: "no-store" });
      if (!res.ok) throw new Error(`API error ${res.status}`);
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

  if (loading) return <div className="text-zinc-400 text-sm py-8">Loading results…</div>;
  if (err)     return <div className="text-red-400 text-sm py-8">{err}</div>;
  if (!data)   return null;

  const { summary, by_date } = data;
  const sorted = [...by_date].reverse();
  const { dirTotal, dirCorrect, avgError, buckets } = computeStats(by_date);

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
            {by_date.length} day{by_date.length !== 1 ? "s" : ""} · {FILTER_LABELS[filter]}
          </div>
        </div>

        {/* filter tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-white/10 rounded-lg p-1">
          {(["yesterday", "7d", "30d", "season"] as Filter[]).map((f) => (
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
              {!day.results_available && <span className="text-xs text-amber-400/70">results pending</span>}
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
                {sortGames(day.games).map((g, i) => <GameCard key={i} g={g} />)}
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
                              <TeamLogo id={g.away_espnTeamId} name={g.away_team} size={16} />
                              <span className="text-zinc-400">{g.away_team}</span>
                            </div>
                            {/* home */}
                            <div className="flex items-center gap-1.5">
                              <TeamLogo id={g.home_espnTeamId} name={g.home_team} size={16} />
                              <span className="text-zinc-200">{g.home_team}</span>
                            </div>
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
                            <SignalBadge signal={g.signal} pickSide={g.pick_side} />
                          </td>
                          <td className="px-3 py-2 text-right font-mono align-middle">
                            {g.away_score !== null && g.home_score !== null ? (
                              <div className="text-right leading-snug">
                                <div className={g.winner === "AWAY" ? "text-zinc-100 font-semibold" : "text-zinc-500"}>{g.away_score}</div>
                                <div className={g.winner === "HOME" ? "text-zinc-100 font-semibold" : "text-zinc-500"}>{g.home_score}</div>
                              </div>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-400 align-middle">
                            {spreadLabel(g.actual_spread)}
                          </td>
                          <td className="px-3 py-2 text-center align-middle">
                            <DirBadge g={g} />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <PickResultBadge result={g.pick_result} />
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
