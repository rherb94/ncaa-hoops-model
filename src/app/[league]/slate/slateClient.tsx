"use client";

import { useEffect, useMemo, useState } from "react";
import type { SlateResponse, UpcomingResponse, DateSlate } from "@/lib/types";
import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";
import SlateTable from "@/components/SlateTable";
import { PageHeader, Segmented, ToolButton } from "@/components/PageHeader";

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

function formatLongDate(dateStr: string): string {
  if (!isYyyyMmDd(dateStr)) return "Slate";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatUpdated(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
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

  const ratings = mode === "today" ? todayData?.ratings : upcomingData?.ratings;

  const gameCount =
    mode === "today"
      ? todayData?.games.length
      : upcomingData?.dates.reduce((n, d) => n + d.games.length, 0);

  return (
    <div className="space-y-3">
      <PageHeader
        title={mode === "today" ? formatLongDate(safeDate) : "Upcoming games"}
        meta={
          <>
            {LEAGUES[league].name}
            {gameCount != null ? <> · {gameCount} game{gameCount === 1 ? "" : "s"} with lines</> : null}
            {ratings?.updatedAt && !ratings.stale ? <> · ratings updated {formatUpdated(ratings.updatedAt)}</> : null}
          </>
        }
      >
        <Segmented
          label="Which games"
          value={mode}
          onChange={setMode}
          options={[
            { value: "today", label: "Today" },
            { value: "upcoming", label: "Upcoming" },
          ]}
        />
        <ToolButton onClick={() => load(true)} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh odds"}
        </ToolButton>
      </PageHeader>

      {err ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
          {err}
        </div>
      ) : null}

      {ratings?.stale ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100"
        >
          {ratings.message}
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
            <div className="rounded-xl border border-white/[0.07] bg-zinc-900/30 px-5 py-10 text-center text-sm text-zinc-500">
              No upcoming games have lines posted yet.
            </div>
          )}
        </div>
      ) : null}

      {!todayData && !upcomingData && !err ? (
        <div className="rounded-xl border border-white/[0.07] bg-zinc-900/30 px-5 py-10 text-center text-sm text-zinc-500">
          Loading lines…
        </div>
      ) : null}
    </div>
  );
}

export default SlateClient;
