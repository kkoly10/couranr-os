import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import SiteFooter from "@/app/components/SiteFooter";

export const metadata: Metadata = {
  title: "Couranr",
  description: "Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          color: "#111827",
        }}
      >
        {/* Global header */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              maxWidth: 1200,
              margin: "0 auto",
              padding: "14px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
            }}
          >
            <Link
              href="/"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textDecoration: "none",
                color: "#111827",
                fontWeight: 900,
                fontSize: 18,
              }}
            >
              <span style={{ letterSpacing: 0.2 }}>Couranr</span>
            </Link>

            <nav style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <NavLink href="/">Home</NavLink>
              <NavLink href="/courier">Courier</NavLink>
              <NavLink href="/docs">Docs</NavLink>
              <NavLink href="/auto">Auto</NavLink>

              {/* Admin entry (optional, but useful) */}
              <NavLink href="/admin">Admin</NavLink>

              {/* Login always visible so homepage never “loses” it */}
              <Link
                href="/login"
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #111827",
                  background: "#111827",
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 900,
                }}
              >
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

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: "8px 10px",
        borderRadius: 10,
        textDecoration: "none",
        fontWeight: 800,
        color: "#111827",
        border: "1px solid transparent",
      }}
    >
      {children}
    </Link>
  );
}