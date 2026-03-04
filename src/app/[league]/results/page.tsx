import { Suspense } from "react";
import ResultsClient from "./resultsClient";
import type { LeagueId } from "@/lib/leagues";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  return (
    <Suspense fallback={<div className="text-zinc-400 text-sm">Loading…</div>}>
      <ResultsClient league={league as LeagueId} />
    </Suspense>
  );
}
