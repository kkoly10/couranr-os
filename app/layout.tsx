// app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Couranr",
  description: "Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="appBody">
        <header className="topbar">
          <div className="c-container topbarInner">
            {/* Brand */}
            <Link href="/" className="brand" aria-label="Couranr home">
              <span className="brandMark" aria-hidden="true">
                <span className="brandC">C</span>
                <span className="brandDot">.</span>
              </span>
              <span className="brandName">Couranr</span>
            </Link>

            {/* Nav */}
            <nav className="topnav" aria-label="Primary">
              <Link className="toplink" href="/courier">
                Courier
              </Link>
              <Link className="toplink" href="/docs">
                Docs
              </Link>
              <Link className="toplink" href="/auto">
                Auto
              </Link>
            </nav>

            {/* Auth (always visible, but does NOT grant access) */}
            <div className="topactions">
              <Link className="btn btn-outline" href="/login">
                Log in
              </Link>
              <Link className="btn btn-gold" href="/signup">
                Create account
              </Link>
            </div>
          </div>
        </header>

        <main className="appMain">{children}</main>

        <footer className="siteFooter">
          <div className="c-container footerInner">
            <div className="footerLeft">
              <div className="footerBrand">
                <span className="footerMark" aria-hidden="true">
                  <span className="brandC">C</span>
                  <span className="brandDot">.</span>
                </span>
                <span>Couranr</span>
              </div>
              <div className="footerNote">Local services, one portal.</div>
            </div>

            <div className="footerRight">
              <span className="footerTiny">© {new Date().getFullYear()} Couranr</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}