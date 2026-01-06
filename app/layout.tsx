import "./globals.css";
import Link from "next/link";
import AuthHeader from "@/components/AuthHeader";

export const metadata = {
  title: "Couranr",
  description: "Courier, Docs, and Auto services",
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
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
          color: "#111",
        }}
      >
        {/* HEADER */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 40,
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              maxWidth: 1200,
              margin: "0 auto",
              padding: "18px 24px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            {/* BRAND */}
            <Link
              href="/"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textDecoration: "none",
                color: "#111",
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 650 }}>
                Couranr
                <span
                  style={{
                    color: "#2563eb",
                    fontSize: 22,
                    marginLeft: 4,
                  }}
                >
                  •
                </span>
              </span>
            </Link>

            {/* NAV */}
            <nav
              style={{
                display: "flex",
                gap: 18,
                alignItems: "center",
              }}
            >
              <Link href="/courier">Courier</Link>
              <Link href="/docs">Docs</Link>
              <Link href="/auto">Auto</Link>

              {/* Auth-aware controls */}
              <AuthHeader />
            </nav>
          </div>
        </header>

        {/* CONTENT */}
        <main
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "28px 20px",
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}