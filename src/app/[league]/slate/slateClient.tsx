"use client";

import { useEffect, useMemo, useState } from "react";
import type { SlateResponse } from "@/lib/types";
import type { LeagueId } from "@/lib/leagues";
import SlateTable from "@/components/SlateTable";

function isYyyyMmDd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function SlateClient({ date, league }: { date: string; league: LeagueId }) {
  const [data, setData] = useState<SlateResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const safeDate = useMemo(() => (isYyyyMmDd(date) ? date : ""), [date]);

  async function load(refresh = false) {
    if (!safeDate) {
      setErr("Invalid date");
      setData(null);
      return;
    }

    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ date: safeDate });
      if (refresh) qs.set("refresh", "1");
      const res = await fetch(`/api/${league}/slate?${qs.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Slate API failed (${res.status}): ${txt}`);
      }

      const json = (await res.json()) as SlateResponse;
      setData(json);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load slate");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeDate]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-400">Daily Slate</div>
          <div className="text-sm font-semibold text-zinc-100">{safeDate}</div>
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

      {data ? <SlateTable games={data.games} league={league} /> : null}

      {!data && !err ? (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-sm text-zinc-300">
          Loading…
        </div>
      ) : null}
    </div>
  );
}

// Keep default export for backwards compatibility
export default SlateClient;
