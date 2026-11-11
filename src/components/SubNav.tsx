"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The tournament bracket page still exists at /<league>/bracket; it is left
// out of the navigation until March. Add { slug: "bracket", label: "Bracket" }
// back here when the field is set.
const SUBNAV_LINKS = [
  { slug: "slate", label: "Slate" },
  { slug: "results", label: "Results" },
  { slug: "analytics", label: "Analytics" },
  { slug: "teams", label: "Teams" },
];

export default function SubNav({ league }: { league: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="scroll-x -mx-4 mb-6 border-b border-white/[0.07] px-4 sm:mx-0 sm:px-0">
      <div className="flex items-center gap-6">
        {SUBNAV_LINKS.map(({ slug, label }) => {
          const href = `/${league}/${slug}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={slug}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2.5 pt-1 text-sm font-medium transition-colors ${
                active
                  ? "border-brand text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
