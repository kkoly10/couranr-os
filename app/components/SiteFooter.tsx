import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer style={{ borderTop: "1px solid #e5e7eb", marginTop: 40 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 24px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color: "#6b7280", fontSize: 12 }}>
          © {new Date().getFullYear()} Couranr Auto. All rights reserved.
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
          <Link href="/terms" style={{ textDecoration: "none", color: "#111827", fontWeight: 800 }}>Terms</Link>
          <Link href="/privacy" style={{ textDecoration: "none", color: "#111827", fontWeight: 800 }}>Privacy</Link>
        </div>
      </div>
    </footer>
  );
}