// app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Couranr",
  description:
    "Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="appBody">
        {/* Public-safe top bar (NO admin links, no auth logic here) */}
        <header className="topbar">
          <div className="container topbarInner">
            <Link href="/" className="brand" aria-label="Couranr home">
              <span className="logoMark" aria-hidden="true">
                <span className="logoC">C</span>
                <span className="logoDot" />
              </span>

              <span className="brandText">
                <span className="brandName">Couranr</span>
                <span className="brandTag">Local services • one OS</span>
              </span>
            </Link>

            <nav className="topNav" aria-label="Primary navigation">
              <Link className="topNavLink" href="/auto">
                Auto
              </Link>
              <Link className="topNavLink" href="/courier">
                Courier
              </Link>
              <Link className="topNavLink" href="/docs">
                Docs
              </Link>
            </nav>

            <div className="topActions">
              <Link className="btn btn-ghost" href="/login">
                Log in
              </Link>
              <Link className="btn btn-gold" href="/signup">
                Create account
              </Link>
            </div>
          </div>
        </header>

        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}