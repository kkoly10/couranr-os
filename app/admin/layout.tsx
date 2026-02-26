"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function onLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <header
        style={{
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/admin"
            style={{
              textDecoration: "none",
              color: "#111827",
              fontWeight: 900,
              fontSize: 20,
            }}
          >
            Couranr{" "}
            <span style={{ fontSize: 13, fontWeight: 500, color: "#6b7280" }}>
              admin
            </span>
          </Link>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Link href="/admin" style={navBtn(pathname === "/admin")}>
              🚚 Deliveries
            </Link>

            <Link href="/admin/auto" style={navBtn(pathname.startsWith("/admin/auto"))}>
              🚗 Auto Rentals
            </Link>

            <Link href="/admin/docs" style={navBtn(pathname.startsWith("/admin/docs"))}>
              📄 Docs
            </Link>

            <button onClick={onLogout} style={ghostBtn}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}

function navBtn(active: boolean): React.CSSProperties {
  return {
    textDecoration: "none",
    color: "#111827",
    fontWeight: active ? 800 : 700,
    fontSize: 14,
    padding: "9px 12px",
    borderRadius: 10,
    border: active ? "1px solid #d1d5db" : "1px solid transparent",
    background: active ? "#f3f4f6" : "transparent",
    display: "inline-block",
  };
}

const ghostBtn: React.CSSProperties = {
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  borderRadius: 10,
  padding: "9px 12px",
  fontWeight: 700,
  cursor: "pointer",
};