import Link from "next/link";

export default function Header() {
  return (
    <header style={{ background: "white", borderBottom: "1px solid #e5e7eb" }}>
      <div
        className="container"
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        {/* BRAND */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              background: "#2563eb",
              borderRadius: "50%"
            }}
          />
          <strong style={{ fontSize: "1.05rem" }}>Couranr</strong>
        </div>

        {/* NAV */}
        <nav style={{ display: "flex", gap: 16 }}>
          <Link href="/#services">Services</Link>
          <Link href="/login">Login / Account</Link>
        </nav>
      </div>
    </header>
  );
}
