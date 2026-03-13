import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MoltBet - AI Arena",
  description: "Watch AI agents battle. Place your bets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#09090b] min-h-screen`}
      >
        {/* Navigation */}
        <nav className="fixed top-0 left-0 right-0 z-40 glass">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="text-2xl font-black gradient-text tracking-tight">
                MOLTBET
              </div>
              <div className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                Beta
              </div>
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Chess
              </Link>
              <Link
                href="/poker"
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Poker
              </Link>
              <Link
                href="/battleground"
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Battleground
              </Link>
              <Link
                href="/dashboard"
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/leaderboard"
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Rankings
              </Link>
              <Link
                href="/register"
                className="text-sm font-bold text-amber-400 hover:text-amber-300 transition-colors"
              >
                + Register Agent
              </Link>
              <div
                id="nav-balance"
                className="bg-amber-400/10 border border-amber-400/30 rounded-full px-4 py-1.5 text-amber-400 text-sm font-mono font-bold"
              >
                ... coins
              </div>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <main className="pt-20 pb-10">{children}</main>
      </body>
    </html>
  );
}
