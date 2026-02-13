"use client";

import { useMemo, useState } from "react";
import {
  americanToImpliedProb,
  expectedValue,
  halfKellyClamped,
  fmtPct,
  fmtMoney,
} from "@/lib/betting";

export default function SheetPage() {
  const [odds, setOdds] = useState<number>(-110);
  const [winProb, setWinProb] = useState<number>(0.53); // your model probability
  const [bankroll, setBankroll] = useState<number>(1000);

  const derived = useMemo(() => {
    const implied = americanToImpliedProb(odds);
    const ev = expectedValue(winProb, odds);
    const halfKelly = halfKellyClamped(winProb, odds, 0.05); // cap at 5% of roll
    const bet = bankroll * halfKelly;

    return { implied, ev, halfKelly, bet };
  }, [odds, winProb, bankroll]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-2 text-2xl font-bold">Betting Sheet</h1>
      <p className="mb-6 text-zinc-500">
        Minimal calculator using{" "}
        <span className="mono">src/lib/betting.ts</span>
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[color:var(--border)] p-4">
          <label className="block text-sm text-zinc-400">American Odds</label>
          <input
            type="number"
            value={odds}
            onChange={(e) => setOdds(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-400"
          />
          <p className="mt-2 text-xs text-zinc-500">Example: -110, +120</p>
        </div>

        <div className="rounded-xl border border-[color:var(--border)] p-4">
          <label className="block text-sm text-zinc-400">
            Your Win Probability
          </label>
          <input
            type="number"
            step="0.001"
            value={winProb}
            onChange={(e) => setWinProb(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-400"
          />
          <p className="mt-2 text-xs text-zinc-500">Enter as 0.53 = 53%</p>
        </div>

        <div className="rounded-xl border border-[color:var(--border)] p-4">
          <label className="block text-sm text-zinc-400">Bankroll</label>
          <input
            type="number"
            value={bankroll}
            onChange={(e) => setBankroll(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-400"
          />
          <p className="mt-2 text-xs text-zinc-500">Used for bet sizing</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--border)] p-4">
          <div className="text-sm text-zinc-400">
            Market Implied Probability
          </div>
          <div className="mt-1 text-2xl font-bold">
            {fmtPct(derived.implied)}
          </div>
          <div className="mt-4 text-sm text-zinc-400">Your Win Probability</div>
          <div className="mt-1 text-2xl font-bold">{fmtPct(winProb)}</div>
        </div>

        <div className="rounded-xl border border-[color:var(--border)] p-4">
          <div className="text-sm text-zinc-400">Expected Value (per $1)</div>
          <div className="mt-1 text-2xl font-bold">{fmtPct(derived.ev)}</div>

          <div className="mt-4 text-sm text-zinc-400">
            Half-Kelly (capped at 5%)
          </div>
          <div className="mt-1 text-2xl font-bold">
            {fmtPct(derived.halfKelly)}
          </div>

          <div className="mt-4 text-sm text-zinc-400">Suggested Bet Size</div>
          <div className="mt-1 text-2xl font-bold">{fmtMoney(derived.bet)}</div>
        </div>
      </div>
    </main>
  );
}
