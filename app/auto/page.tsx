import Link from "next/link";

export default function AutoLanding() {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 34, margin: 0 }}>Couranr Auto Rentals</h1>
      <p style={{ marginTop: 10, color: "#444", lineHeight: 1.6 }}>
        Browse available cars, submit renter information, sign your agreement, and pay online.
      </p>

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/auto/rent" style={btnPrimary}>View available cars</Link>
        <Link href="/dashboard" style={btnGhost}>Go to dashboard</Link>
      </div>
    </main>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 10,
  background: "#111827",
  color: "#fff",
  fontWeight: 800,
  textDecoration: "none",
};

const btnGhost: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 800,
  textDecoration: "none",
};