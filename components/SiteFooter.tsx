import Link from "next/link";

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer style={{ borderTop: "1px solid var(--border)", padding: "40px 0", marginTop: "40px", background: "rgba(255, 255, 255, 0.4)" }}>
      <div className="cContainer">
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "24px" }}>
          
          <div style={{ color: "var(--muted)", fontSize: "14px", lineHeight: "1.6" }}>
            <strong style={{ color: "var(--text)" }}>© {year} Couranr</strong> <br />
            <a href="mailto:couranr@couranrauto.com" style={{ textDecoration: "underline", textUnderlineOffset: "2px" }}>
              couranr@couranrauto.com
            </a>
          </div>

          <nav style={{ display: "flex", gap: "24px", alignItems: "center", fontSize: "14px", flexWrap: "wrap" }} aria-label="Footer Navigation">
            <Link href="/terms" style={{ color: "var(--muted)", fontWeight: 500 }}>
              Terms of Service
            </Link>
            <Link href="/privacy" style={{ color: "var(--muted)", fontWeight: 500 }}>
              Privacy Policy
            </Link>
            <Link href="/portal" style={{ background: "var(--text)", color: "#fff", padding: "8px 16px", borderRadius: "8px", fontWeight: 700 }}>
              Customer Portal →
            </Link>
          </nav>

        </div>
      </div>
    </footer>
  );
}
