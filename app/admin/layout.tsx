import Link from "next/link";
import Brand from "@/components/Brand";
import LogoutButton from "@/components/LogoutButton";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section>
      <header
        style={{
          borderBottom: "3px solid #7c3aed",
          background:
            "linear-gradient(180deg, rgba(124,58,237,0.12), #ffffff 60%)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "18px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Brand href="/admin" role="admin" />

          <nav style={{ display: "flex", gap: 14 }}>
            <Link href="/admin" style={navLink}>
              🚚 Deliveries
            </Link>
            <Link href="/admin/auto" style={navLink}>
              🚗 Auto Rentals
            </Link>
            <span style={{ opacity: 0.4 }}>📄 Docs</span>
          </nav>

          <LogoutButton />
        </div>
      </header>

      <main
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "28px 24px",
        }}
      >
        {children}
      </main>
    </section>
  );
}

const navLink: React.CSSProperties = {
  fontWeight: 800,
  textDecoration: "none",
  color: "#111",
};