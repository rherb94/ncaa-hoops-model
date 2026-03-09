"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SUBNAV_LINKS = [
  { slug: "slate",     label: "Daily Slate" },
  { slug: "results",   label: "Results" },
  { slug: "teams",     label: "Teams" },
  { slug: "sheet",     label: "Betting Sheet" },
  { slug: "analytics", label: "Analytics" },
];

export default function SubNav({ league }: { league: string }) {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex items-center gap-1 border-b border-white/8 pb-3 overflow-x-auto">
      {SUBNAV_LINKS.map(({ slug, label }) => {
        const href = `/${league}/${slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={slug}
            href={href}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
