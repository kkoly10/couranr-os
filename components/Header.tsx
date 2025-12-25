import Link from "next/link";
import Brand from "./Brand";

export default function Header() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb"
      }}
    >
      <div className="container">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 64
          }}
        >
          <Brand />

          <nav style={{ display: "flex", gap: 12 }}>
            <Link className="navLink" href="/#services">
              Services
            </Link>
            <Link className="navLink" href="/login">
              Login / Account
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
