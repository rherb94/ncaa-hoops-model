import { Suspense } from "react";
import AnalyticsClient from "./analyticsClient";
import type { LeagueId } from "@/lib/leagues";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  return (
    <Suspense fallback={<div className="text-zinc-400 text-sm">Loading analytics…</div>}>
      <AnalyticsClient league={league as LeagueId} />
    </Suspense>
  );
}
