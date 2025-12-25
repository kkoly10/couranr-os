import Link from "next/link";

export default function Header() {
  return (
    <header style={{ background: "white", borderBottom: "1px solid #e5e7eb" }}>
      <div className="container" style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, background: "#2563eb", borderRadius: "50%" }} />
          <strong>Couranr</strong>
        </div>

        <nav style={{ display: "flex", gap: 16 }}>
          <Link href="/#services">Services</Link>
          <Link href="/login">Login</Link>
        </nav>
      </div>
    </header>
  );
}
