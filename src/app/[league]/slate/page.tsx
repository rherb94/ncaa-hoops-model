import { SlateClient } from "./slateClient";
import type { LeagueId } from "@/lib/leagues";

// Returns today's date in Eastern Time as YYYY-MM-DD
function getTodayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export default async function SlatePage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const date = getTodayET();
  return <SlateClient date={date} league={league as LeagueId} />;
}
