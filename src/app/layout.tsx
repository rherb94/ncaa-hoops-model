import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import LeagueNav from "@/components/LeagueNav";

export const metadata: Metadata = {
  title: "Hoops Model",
  description: "College basketball betting model dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <header className="border-b border-white/10 bg-zinc-950/70 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto flex w-full max-w-none items-center justify-between px-6 py-3.5">
            <Link href="/" className="text-base font-bold tracking-tight hover:text-white transition-colors">
              Hoops Model
            </Link>
            <LeagueNav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-none px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
