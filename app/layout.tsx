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
        <header className="topbar">
          <div className="container topbarInner">
            <Link href="/" className="brand" aria-label="Couranr home">
              <span className="brandMark" aria-hidden="true">
                C<span className="brandDot">.</span>
              </span>
              <span className="brandWord">Couranr</span>
            </Link>

            <nav className="nav" aria-label="Primary">
              <Link className="navLink" href="/courier">
                Courier
              </Link>
              <Link className="navLink" href="/docs">
                Docs
              </Link>
              <Link className="navLink" href="/auto">
                Auto
              </Link>
            </nav>

            <div className="navActions">
              <Link className="navLink subtle" href="/login">
                Log in
              </Link>
              <Link className="btn btnSecondary" href="/signup">
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