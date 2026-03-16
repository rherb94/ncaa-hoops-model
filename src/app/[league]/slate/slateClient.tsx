"use client";

import { useEffect, useMemo, useState } from "react";
import type { SlateResponse, UpcomingResponse, DateSlate } from "@/lib/types";
import type { LeagueId } from "@/lib/leagues";
import SlateTable from "@/components/SlateTable";

type ViewMode = "today" | "upcoming";

function isYyyyMmDd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function formatDateHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function SlateClient({ date, league }: { date: string; league: LeagueId }) {
  const [mode, setMode] = useState<ViewMode>("today");
  const [todayData, setTodayData] = useState<SlateResponse | null>(null);
  const [upcomingData, setUpcomingData] = useState<UpcomingResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const safeDate = useMemo(() => (isYyyyMmDd(date) ? date : ""), [date]);

  async function loadToday(refresh = false) {
    if (!safeDate) {
      setErr("Invalid date");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ date: safeDate });
      if (refresh) qs.set("refresh", "1");
      const res = await fetch(`/api/${league}/slate?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Slate API failed (${res.status}): ${await res.text()}`);
      setTodayData(await res.json() as SlateResponse);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load slate");
      setTodayData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadUpcoming(refresh = false) {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ mode: "upcoming" });
      if (refresh) qs.set("refresh", "1");
      const res = await fetch(`/api/${league}/slate?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Slate API failed (${res.status}): ${await res.text()}`);
      setUpcomingData(await res.json() as UpcomingResponse);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load upcoming");
      setUpcomingData(null);
    } finally {
      setLoading(false);
    }
  }

  function load(refresh = false) {
    if (mode === "today") loadToday(refresh);
    else loadUpcoming(refresh);
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeDate, mode]);

  const pillBase = "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors";
  const pillActive = "bg-cyan-600/30 text-cyan-300 border border-cyan-500/40";
  const pillInactive = "bg-zinc-800/60 text-zinc-400 border border-white/5 hover:bg-zinc-800";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs text-zinc-400">
              {mode === "today" ? "Daily Slate" : "All Upcoming"}
            </div>
            <div className="text-sm font-semibold text-zinc-100">
              {mode === "today" ? safeDate : `${upcomingData?.dates.length ?? 0} dates`}
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 ml-2">
            <button
              className={`${pillBase} ${mode === "today" ? pillActive : pillInactive}`}
              onClick={() => setMode("today")}
            >
              Today
            </button>
            <button
              className={`${pillBase} ${mode === "upcoming" ? pillActive : pillInactive}`}
              onClick={() => setMode("upcoming")}
            >
              Upcoming
            </button>
          </div>
        </div>

        <button
          onClick={() => load(true)}
          disabled={loading}
          className="rounded-xl border border-white/10 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-950/10 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh odds"}
        </button>
      </div>

      {err ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
          {err}
        </div>
      ) : null}

      {/* Today view */}
      {mode === "today" && todayData ? (
        <SlateTable games={todayData.games} league={league} />
      ) : null}

      {/* Upcoming view */}
      {mode === "upcoming" && upcomingData ? (
        <div className="space-y-6">
          {upcomingData.dates.map((ds) => (
            <div key={ds.date}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-200">
                  {formatDateHeading(ds.date)}
                </h3>
                <span className="text-xs text-zinc-500">{ds.games.length} games</span>
              </div>
              <SlateTable games={ds.games} league={league} />
            </div>
          ))}
          {upcomingData.dates.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-sm text-zinc-400">
              No upcoming games with available odds.
            </div>
          )}
        </div>
      ) : null}

      {!todayData && !upcomingData && !err ? (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-sm text-zinc-300">
          Loading…
        </div>
      ) : null}
    </div>
  );
}

export default SlateClient;
