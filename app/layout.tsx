// app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

export const metadata: Metadata = {
  title: "Couranr",
  description:
    "Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check (prevents the “still shows login” issue)
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const isAuthed = !!session;

  return (
    <html lang="en">
      <body className="appBody">
        {/* PUBLIC NAV ONLY (hidden once authed) */}
        {!isAuthed && (
          <header className="topbar">
            <div className="topbarInner">
              <div className="topbarLeft">
                <Link href="/" className="brand" aria-label="Couranr home">
                  <span className="brandMark" aria-hidden="true">
                    <span className="brandC">C</span>
                    <span className="brandDot">.</span>
                  </span>
                  <span className="brandName">Couranr</span>
                </Link>

                <nav className="topbarNav" aria-label="Public navigation">
                  <Link className="topLink" href="/auto">
                    Auto
                  </Link>
                  <Link className="topLink" href="/courier">
                    Courier
                  </Link>
                  <Link className="topLink" href="/docs">
                    Docs
                  </Link>
                </nav>
              </div>

              <div className="topbarRight">
                <Link className="btn btn-ghost" href="/login">
                  Log in
                </Link>
                <Link className="btn btn-gold" href="/signup">
                  Create account
                </Link>
              </div>
            </div>
          </header>
        )}

        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}
