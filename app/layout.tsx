// app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Couranr",
  description: "Couranr — Auto, Delivery, and Docs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={body}>
        <div style={shell}>
          {/* Main content */}
          <div style={contentWrap}>{children}</div>

          {/* Global footer (non-admin pages will show this automatically) */}
          <footer style={footer}>
            <div style={footerInner}>
              <div style={brandRow}>
                <span style={brand}>Couranr</span>
                <span style={dot}>•</span>
                <span style={muted}>Local services powered by one platform</span>
              </div>

              <nav style={footerNav}>
                <Link href="/terms" style={footerLink}>
                  Terms of Use
                </Link>
                <Link href="/privacy" style={footerLink}>
                  Privacy Policy
                </Link>
              </nav>

              <div style={smallPrint}>
                © {new Date().getFullYear()} Couranr. All rights reserved.
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

/* ---------------- styles ---------------- */

const body: React.CSSProperties = {
  margin: 0,
  background: "#f8fafc",
  color: "#0f172a",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
};

const shell: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
};

const contentWrap: React.CSSProperties = {
  flex: 1,
};

const footer: React.CSSProperties = {
  borderTop: "1px solid #e5e7eb",
  background: "#ffffff",
};

const footerInner: React.CSSProperties = {
  maxWidth: 1200,
  margin: "0 auto",
  padding: "18px 24px",
  display: "grid",
  gap: 10,
};

const brandRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const brand: React.CSSProperties = {
  fontWeight: 900,
  letterSpacing: 0.2,
};

const dot: React.CSSProperties = {
  opacity: 0.35,
};

const muted: React.CSSProperties = {
  color: "#64748b",
  fontSize: 13,
  fontWeight: 600,
};

const footerNav: React.CSSProperties = {
  display: "flex",
  gap: 14,
  flexWrap: "wrap",
};

const footerLink: React.CSSProperties = {
  textDecoration: "none",
  color: "#0f172a",
  fontWeight: 800,
  fontSize: 13,
};

const smallPrint: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 700,
};