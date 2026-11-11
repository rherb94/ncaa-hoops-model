"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEAGUES } from "@/lib/leagues";

const FULL_NAME: Record<string, string> = {
  ncaam: "Men's college basketball",
  ncaaw: "Women's college basketball",
  cfb: "College football",
};

/** League switcher: a single segmented control in the header. */
export default function LeagueNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="League" className="flex items-center rounded-lg border border-white/[0.08] bg-zinc-900/70 p-0.5">
      {Object.values(LEAGUES).map((l) => {
        const active = pathname.startsWith(`/${l.id}/`) || pathname === `/${l.id}`;
        return (
          <Link
            key={l.id}
            href={`/${l.id}/slate`}
            title={FULL_NAME[l.id]}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3 ${
              active ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {l.shortName}
          </Link>
        );
      })}
    </nav>
  );
}
