import Link from "next/link";
import Brand from "@/components/Brand";
import LogoutButton from "@/components/LogoutButton";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <section>
      <header
        style={{
          borderBottom: "1px solid rgba(15,23,42,0.10)",
          background: "rgba(255,255,255,0.78)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "14px 22px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Brand href="/dashboard/home" role="customer" />

          <nav style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Link href="/dashboard/home" style={navLink}>
              Dashboard
            </Link>
            <Link href="/dashboard/delivery" style={navLink}>
              Deliveries
            </Link>
            <Link href="/dashboard/auto" style={navLink}>
              Auto
            </Link>
            <span style={{ opacity: 0.5 }}>Docs</span>
          </nav>

          <LogoutButton />
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "22px" }}>
        {children}
      </main>
    </section>
  );
}

const navLink: React.CSSProperties = {
  fontWeight: 900,
  textDecoration: "none",
  color: "rgba(15,23,42,0.90)",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.70)",
};
