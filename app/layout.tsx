// app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import SiteFooter from "@/app/components/SiteFooter";

export const metadata: Metadata = {
  title: "Couranr",
  description:
    "Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {/* Global header */}
        <header className="siteHeader">
          <div className="siteHeaderInner">
            <Link href="/" className="brandLink" aria-label="Couranr home">
              <span className="brandName">Couranr</span>
            </Link>

            <nav className="siteNav" aria-label="Primary navigation">
              <Link className="navLink" href="/">
                Home
              </Link>
              <Link className="navLink" href="/courier">
                Courier
              </Link>
              <Link className="navLink" href="/docs">
                Docs
              </Link>
              <Link className="navLink" href="/auto">
                Auto
              </Link>

              <span className="navDivider" aria-hidden="true" />

              <Link className="navLink" href="/admin">
                Admin
              </Link>

              {/* Helpful for renters coming back */}
              <Link className="navLink" href="/login">
                Customer portal
              </Link>

              <Link className="btn btnPrimary" href="/login">
                Log in
              </Link>
            </nav>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1 }}>{children}</main>

        {/* Global footer */}
        <SiteFooter />
      </body>
    </html>
  );
}