// src/components/SlateTable.tsx
"use client";

import type { SlateGame } from "@/lib/types";

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

/**
 * Make Edge readable but not screaming.
 * Keep it mostly neutral, slightly green/red only for meaningful edges.
 */
function edgeClass(edge?: number) {
  if (edge === undefined || Number.isNaN(edge)) return "text-zinc-400";
  const a = Math.abs(edge);
  if (a >= 8) return edge > 0 ? "text-emerald-200" : "text-rose-200";
  if (a >= 4) return edge > 0 ? "text-emerald-300/90" : "text-rose-300/90";
  if (a >= 2) return edge > 0 ? "text-emerald-300/70" : "text-rose-300/70";
  return "text-zinc-300";
}

/**
 * Signal pill is the primary visual emphasis.
 */
function signalPillClass(signal?: SlateGame["model"]["signal"]) {
  switch (signal) {
    case "STRONG":
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
    case "LEAN":
      return "border-amber-300/40 bg-amber-300/10 text-amber-100";
    default:
      return "border-white/10 bg-zinc-900/60 text-zinc-200";
  }
}

/**
 * Rec is secondary emphasis, but still colored.
 */
function recPillClass(side?: "HOME" | "AWAY" | "NONE") {
  if (side === "HOME") return "border-rose-400/40 bg-rose-400/10 text-rose-100";
  if (side === "AWAY")
    return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
  return "border-white/10 bg-zinc-900/60 text-zinc-200";
}

/**
 * Row tint: very subtle background to help scanning.
 */
function rowTint(signal?: SlateGame["model"]["signal"]) {
  if (signal === "STRONG") return "bg-emerald-500/5";
  if (signal === "LEAN") return "bg-amber-500/5";
  return "";
}

export default function SlateTable({ games }: { games: SlateGame[] }) {
  if (!games?.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-sm text-zinc-300">
        No games returned.
      </div>
    );
  }

  const sorted = [...games].sort((a, b) => {
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

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="text-sm font-semibold text-zinc-100">Daily Slate</div>
        <div className="text-xs text-zinc-400">
          Sorted by Signal → |Edge| → Time
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1350px] w-full text-sm">
          <thead className="sticky top-0 bg-black/70 text-left text-zinc-200 backdrop-blur">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
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
            {sorted.map((g) => (
              <tr
                key={g.gameId}
                className={`hover:bg-zinc-900/60 transition-colors ${rowTint(
                  g.model.signal
                )}`}
              >
                <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">
                  {fmtTime(g.startTimeISO)}
                </td>

                <td className="px-3 py-2 font-medium text-zinc-100">
                  {g.awayTeam}
                </td>
                <td className="px-3 py-2 font-medium text-zinc-100">
                  {g.homeTeam}
                </td>

                <td className="px-3 py-2 tabular-nums text-zinc-200">
                  {fmtNum(g.consensus?.spread, 1)}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-200">
                  {fmtNum(g.consensus?.total, 1)}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-200">
                  {fmtInt(g.consensus?.moneylineAway)}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-200">
                  {fmtInt(g.consensus?.moneylineHome)}
                </td>

                <td className="px-3 py-2">
                  <span className="rounded-full border border-white/10 bg-zinc-900/60 px-2 py-0.5 text-xs text-zinc-200">
                    {g.consensus?.source ?? "—"}
                  </span>
                </td>

                <td className="px-3 py-2 tabular-nums text-zinc-200">
                  {fmtNum(g.model?.awayPR, 1)}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-200">
                  {fmtNum(g.model?.homePR, 1)}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-200">
                  {fmtNum(g.model?.hca, 1)}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-200">
                  {fmtNum(g.model?.modelSpread, 1)}
                </td>

                <td
                  className={`px-3 py-2 font-semibold tabular-nums ${edgeClass(
                    g.model.edge
                  )}`}
                >
                  {fmtNum(g.model?.edge, 1)}
                </td>

                <td className="px-3 py-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${signalPillClass(
                      g.model.signal
                    )}`}
                  >
                    {g.model.signal}
                  </span>
                </td>

                <td className="px-3 py-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${recPillClass(
                      g.recommended?.side
                    )}`}
                  >
                    {g.recommended?.side ?? "NONE"}
                  </span>
                </td>

                <td className="px-3 py-2 tabular-nums">
                  {g.recommended?.side === "NONE" ? (
                    <span className="text-zinc-400">—</span>
                  ) : (
                    <span className="text-zinc-100">
                      {fmtNum(g.recommended?.line, 1)}{" "}
                      <span className="text-xs text-zinc-400">
                        ({g.recommended?.book ?? "—"})
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
