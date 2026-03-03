import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NCAA Hoops Model",
  description: "College basketball betting model dashboard",
};

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
    >
      {label}
    </Link>
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
        <header className="border-b border-white/10 bg-zinc-950/70 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-4">
            <div className="text-lg font-bold tracking-tight">
              NCAA Hoops Model
            </div>

            <nav className="flex items-center gap-2">
              <NavLink href="/slate" label="Daily Slate" />
              <NavLink href="/results" label="Results" />
              <NavLink href="/teams" label="Teams" />
              <NavLink href="/sheet" label="Betting Sheet" />
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
