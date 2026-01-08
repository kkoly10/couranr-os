import Link from "next/link";

export default function AutoHomePage() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>Couranr Auto Rentals</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Reliable, affordable vehicles. Book online in minutes.
      </p>

      <Link href="/auto/vehicles">
        <button
          style={{
            padding: "12px 18px",
            borderRadius: 10,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          View Available Cars
        </button>
      </Link>
    </div>
  );
}