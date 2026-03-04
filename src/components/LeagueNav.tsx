"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEAGUES } from "@/lib/leagues";

export default function LeagueNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {Object.values(LEAGUES).map((l) => {
        const active = pathname.startsWith(`/${l.id}/`) || pathname === `/${l.id}`;
        // NCAAM → sky blue tint, NCAAW → rose/pink tint
        const activeClass =
          l.id === "ncaam"
            ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25"
            : "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/25";

        return (
          <Link
            key={l.id}
            href={`/${l.id}/slate`}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              active
                ? activeClass
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
          >
            {l.shortName}
          </Link>
        );
      })}
    </nav>
  );
}
