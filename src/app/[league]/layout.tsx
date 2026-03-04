// src/app/[league]/layout.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { isLeagueId } from "@/lib/leagues";

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
      <nav className="mb-6 flex items-center gap-1 border-b border-white/8 pb-3">
        {[
          { href: `/${league}/slate`, label: "Daily Slate" },
          { href: `/${league}/results`, label: "Results" },
          { href: `/${league}/teams`, label: "Teams" },
          { href: `/${league}/sheet`, label: "Betting Sheet" },
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
