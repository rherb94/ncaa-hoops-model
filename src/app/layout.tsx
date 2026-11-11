import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";
import LeagueNav from "@/components/LeagueNav";

export const metadata: Metadata = {
  title: "Hoops Model",
  description: "College basketball and football betting model: daily lines, plays and results.",
};

export const viewport: Viewport = {
  themeColor: "#0c1016",
};

/** A basketball seam drawn as two arcs and a line — the only ornament on the site. */
function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px] shrink-0">
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="var(--color-brand)" strokeWidth="1.5" />
      <path d="M12 1.75v20.5M1.75 12h20.5" stroke="var(--color-brand)" strokeWidth="1.5" />
      <path
        d="M4.6 4.9c2.5 1.9 3.9 4.4 3.9 7.1s-1.4 5.2-3.9 7.1M19.4 4.9c-2.5 1.9-3.9 4.4-3.9 7.1s1.4 5.2 3.9 7.1"
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-zinc-950/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-zinc-100 [font-stretch:108%]"
            >
              <BrandMark />
              <span className="hidden whitespace-nowrap min-[340px]:inline">Hoops Model</span>
            </Link>
            <LeagueNav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1320px] px-4 pb-16 pt-5 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
