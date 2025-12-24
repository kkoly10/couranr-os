import Link from "next/link";
import Brand from "./Brand";

export default function Header() {
  return (
    <header className="siteHeader">
      <div className="container">
        <div className="siteHeaderInner">
          <Brand />

          <nav className="navLinks" aria-label="Primary navigation">
            <Link className="navLink" href="/#services">
              Services
            </Link>

            <Link
              className="navLink"
              href="/login"
              style={{
                color: "var(--text)",
                borderColor: "rgba(226,232,240,0.9)",
                background: "rgba(241,245,249,0.65)"
              }}
            >
              Login / Account
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
