// src/app/[league]/layout.tsx
import { notFound } from "next/navigation";
import { isLeagueId } from "@/lib/leagues";
import SubNav from "@/components/SubNav";

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;

  if (!isLeagueId(league)) {
    notFound();
  }

  return (
    <div>
      <SubNav league={league} />
      {children}
    </div>
  );
}
