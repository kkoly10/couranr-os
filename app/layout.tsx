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
          <div className="topbarInner">
            <Link href="/" className="brand" aria-label="Couranr home">
              <span className="brandMark" aria-hidden="true">
                C<span className="brandDot">.</span>
              </span>
              <span className="brandWord">Couranr</span>
            </Link>

            <nav className="topnav" aria-label="Primary navigation">
              <Link className="topnavLink" href="/courier">
                Courier
              </Link>
              <Link className="topnavLink" href="/docs">
                Docs
              </Link>
              <Link className="topnavLink" href="/auto">
                Auto
              </Link>
            </nav>

            <div className="topActions">
              <Link className="topnavLink" href="/login">
                Log in
              </Link>
              <Link className="btn btn-primary" href="/signup">
                Create account
              </Link>
            </div>
          </div>
        </header>

        <main className="appMain">{children}</main>

        <footer className="siteFooter">
          <div className="siteFooterInner">
            <div className="siteFooterLeft">© Couranr</div>
            <div className="siteFooterLinks">
              <Link className="footerLink" href="/privacy">
                Privacy
              </Link>
              <Link className="footerLink" href="/terms">
                Terms
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}