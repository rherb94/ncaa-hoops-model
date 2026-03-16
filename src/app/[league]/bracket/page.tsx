import { Suspense } from "react";
import BracketClient from "./bracketClient";
import type { LeagueId } from "@/lib/leagues";

export default async function BracketPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  return (
    <Suspense fallback={<div className="text-zinc-400 text-sm">Loading bracket…</div>}>
      <BracketClient league={league as LeagueId} />
    </Suspense>
  );
}
