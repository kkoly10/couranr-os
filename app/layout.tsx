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
          <div className="container topbarInner">
            <Link href="/" className="brand" aria-label="Couranr home">
              <span className="logoMark" aria-hidden="true">
                <span className="logoC">C</span>
                <span className="logoDot" />
              </span>

              <span className="brandText">
                <span className="brandName">Couranr</span>
                <span className="brandTag">Auto • Courier • Docs</span>
              </span>
            </Link>

            <div className="btnRow">
              <Link className="btn btnGhost" href="/login">
                Log in
              </Link>
              <Link className="btn btnGold" href="/signup">
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