"use client";

import { useEffect, useState } from "react";

// ---- types matching /api/analysis response ----
type GameRow = {
  date: string;
  home_team: string;
  away_team: string;
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
function spreadLabel(n: number | null) {
  if (n === null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function pickResultBadge(result: GameRow["pick_result"], signal: string, pickSide: string) {
  if (result === "NO_PICK") return null;

  const base = "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold";
  if (result === "WIN")   return <span className={`${base} bg-emerald-500/20 text-emerald-400`}>WIN</span>;
  if (result === "LOSS")  return <span className={`${base} bg-red-500/20 text-red-400`}>LOSS</span>;
  if (result === "PUSH")  return <span className={`${base} bg-zinc-500/20 text-zinc-400`}>PUSH</span>;
  if (result === "PENDING") return <span className={`${base} bg-amber-500/20 text-amber-400`}>PENDING</span>;
  return null;
}

function signalBadge(signal: string, pickSide: string) {
  if (signal === "NONE") return <span className="text-zinc-600 text-xs">—</span>;
  const color = signal === "STRONG" ? "text-emerald-400" : "text-amber-400";
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {signal} {pickSide}
    </span>
  );
}

function edgeLabel(edge: number | null) {
  if (edge === null) return "—";
  const color = Math.abs(edge) >= 5
    ? "text-emerald-400"
    : Math.abs(edge) >= 3
    ? "text-amber-400"
    : "text-zinc-400";
  return <span className={`font-mono text-xs ${color}`}>{edge > 0 ? `+${edge}` : edge}</span>;
}

function RecordBadge({ record, label }: { record: string; label: string }) {
  const isPending = record === "pending";
  const [w, l] = isPending ? [0, 0] : record.split("-").map(Number);
  const winPct = w + l > 0 ? Math.round((w / (w + l)) * 100) : null;

  return (
    <div className="rounded-lg bg-zinc-900 border border-white/10 px-4 py-3 min-w-[120px]">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="text-lg font-bold text-zinc-100">
        {isPending ? "—" : record}
      </div>
      {winPct !== null && (
        <div className="text-xs text-zinc-400">{winPct}% ATS</div>
      )}
    </div>
  );
}

// ---- main component ----
export default function ResultsClient() {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/analysis", { cache: "no-store" });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = (await res.json()) as AnalysisResponse;
      setData(json);
      // auto-expand the most recent date
      if (json.by_date.length > 0) {
        setExpandedDate(json.by_date[json.by_date.length - 1].date);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load results");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="text-zinc-400 text-sm py-8">Loading results…</div>;
  if (err)     return <div className="text-red-400 text-sm py-8">{err}</div>;
  if (!data)   return null;

  const { summary, by_date } = data;
  const sorted = [...by_date].reverse(); // most recent first

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-400">Model Results</div>
          <div className="text-sm text-zinc-500">
            Last {by_date.length} day{by_date.length !== 1 ? "s" : ""} with snapshot data
          </div>
        </div>
        <button
          onClick={load}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
        >
          Refresh
        </button>
      </div>

      {/* summary stats */}
      {summary.total_picks > 0 && (
        <div className="flex flex-wrap gap-3">
          <RecordBadge
            record={summary.decided > 0 ? `${summary.wins}-${summary.losses}` : "pending"}
            label="Overall ATS"
          />
          <div className="rounded-lg bg-zinc-900 border border-white/10 px-4 py-3 min-w-[120px]">
            <div className="text-xs text-zinc-500 mb-1">Total Picks</div>
            <div className="text-lg font-bold text-zinc-100">{summary.total_picks}</div>
            <div className="text-xs text-zinc-400">{summary.decided} decided</div>
          </div>
        </div>
      )}

      {by_date.length === 0 && (
        <div className="text-zinc-500 text-sm">
          No snapshot data yet. Run the odds opener workflow to start tracking.
        </div>
      )}

      {/* per-day sections */}
      {sorted.map((day) => (
        <div key={day.date} className="rounded-xl border border-white/10 overflow-hidden">
          {/* day header */}
          <button
            className="w-full flex items-center justify-between px-4 py-3 bg-zinc-900 hover:bg-zinc-800 transition-colors"
            onClick={() => setExpandedDate(expandedDate === day.date ? null : day.date)}
          >
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-zinc-100">{day.date}</span>
              <span className="text-xs text-zinc-500">
                {day.total_games} games · {day.picks_made} pick{day.picks_made !== 1 ? "s" : ""}
                {day.strong_picks > 0 && ` (${day.strong_picks} STRONG)`}
              </span>
              {!day.results_available && (
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

          {/* game table */}
          {expandedDate === day.date && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-zinc-500">
                    <th className="px-4 py-2 text-left font-medium">Matchup</th>
                    <th className="px-3 py-2 text-right font-medium">Opening</th>
                    <th className="px-3 py-2 text-right font-medium">Model</th>
                    <th className="px-3 py-2 text-right font-medium">Edge</th>
                    <th className="px-3 py-2 text-left font-medium">Pick</th>
                    <th className="px-3 py-2 text-right font-medium">Score</th>
                    <th className="px-3 py-2 text-right font-medium">Actual</th>
                    <th className="px-3 py-2 text-left font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {day.games
                    .slice()
                    .sort((a, b) => {
                      // picks first, then by abs edge desc
                      const aHasPick = a.signal !== "NONE" ? 1 : 0;
                      const bHasPick = b.signal !== "NONE" ? 1 : 0;
                      if (bHasPick !== aHasPick) return bHasPick - aHasPick;
                      return Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0);
                    })
                    .map((g, i) => {
                      const hasPick = g.signal !== "NONE";
                      return (
                        <tr
                          key={i}
                          className={`border-b border-white/5 ${
                            hasPick
                              ? g.pick_result === "WIN"
                                ? "bg-emerald-950/30"
                                : g.pick_result === "LOSS"
                                ? "bg-red-950/30"
                                : "bg-zinc-900/50"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-2 text-zinc-200">
                            <span className="text-zinc-400">{g.away_team}</span>
                            <span className="text-zinc-600 mx-1">@</span>
                            <span>{g.home_team}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-300">
                            {spreadLabel(g.opening_spread)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-300">
                            {spreadLabel(g.model_spread)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {edgeLabel(g.edge)}
                          </td>
                          <td className="px-3 py-2">
                            {signalBadge(g.signal, g.pick_side)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-300">
                            {g.away_score !== null && g.home_score !== null
                              ? `${g.away_score}-${g.home_score}`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-400">
                            {spreadLabel(g.actual_spread)}
                          </td>
                          <td className="px-3 py-2">
                            {pickResultBadge(g.pick_result, g.signal, g.pick_side)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
