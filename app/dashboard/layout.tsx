// app/dashboard/layout.tsx
"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function onLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const linkStyle = (active: boolean): CSSProperties => ({
    ...styles.navLink,
    background: active ? "#eef2ff" : "#fff",
    borderColor: active ? "#c7d2fe" : "#e5e7eb",
    color: active ? "#312e81" : "#111827",
    fontWeight: active ? 800 : 600,
  });

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <Link href="/dashboard" style={styles.brand}>
            Couranr
          </Link>

          <div style={styles.navWrap}>
            <Link
              href="/dashboard/delivery"
              style={linkStyle(pathname.startsWith("/dashboard/delivery"))}
            >
              🚚 Deliveries
            </Link>

            <Link
              href="/dashboard/auto"
              style={linkStyle(pathname.startsWith("/dashboard/auto"))}
            >
              🚗 Auto Rentals
            </Link>

            <Link
              href="/dashboard/docs"
              style={linkStyle(pathname.startsWith("/dashboard/docs"))}
            >
              📄 Docs
            </Link>

            <button onClick={onLogout} style={styles.logoutBtn}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main style={styles.main}>{children}</main>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100vh",
    background: "#f8fafc",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    background: "rgba(255,255,255,0.95)",
    borderBottom: "1px solid #e5e7eb",
    backdropFilter: "blur(8px)",
  },
  headerInner: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  brand: {
    textDecoration: "none",
    color: "#111827",
    fontWeight: 900,
    fontSize: 20,
    letterSpacing: 0.2,
  },
  navWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  navLink: {
    textDecoration: "none",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 14,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    whiteSpace: "nowrap",
  },
  logoutBtn: {
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111827",
    borderRadius: 10,
    padding: "8px 10px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 14,
  },
  main: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: 16,
  },
};