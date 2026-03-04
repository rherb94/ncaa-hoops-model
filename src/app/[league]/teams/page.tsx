import TeamsClient from "./teamsClient";
import type { LeagueId } from "@/lib/leagues";

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  return <TeamsClient league={league as LeagueId} />;
}
