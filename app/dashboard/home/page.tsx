"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CustomerDashboardHome() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setAuthed(false);
        setLoading(false);
        return;
      }
      setAuthed(true);
      setLoading(false);
    }
    boot();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return <p style={{ padding: 24 }}>Loading dashboard…</p>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Dashboard</h1>
          <p style={styles.sub}>Manage your services</p>
        </div>

        {authed && (
          <button onClick={logout} style={styles.ghostBtn}>
            Logout
          </button>
        )}
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>🚚 Deliveries</h2>
          <p style={styles.cardText}>
            Track deliveries, upload pickup photos, and view history.
          </p>
          <Link href="/dashboard/delivery" style={styles.primaryLink}>
            Delivery Dashboard
          </Link>
          <div style={{ height: 10 }} />
          <Link href="/courier" style={styles.secondaryLink}>
            New Delivery
          </Link>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>🚗 Auto Rentals</h2>
          <p style={styles.cardText}>
            View rentals, agreements, photos, and payments.
          </p>
          <Link href="/dashboard/auto" style={styles.primaryLink}>
            Auto Dashboard
          </Link>
          <div style={{ height: 10 }} />
          <Link href="/auto/vehicles" style={styles.secondaryLink}>
            View Cars
          </Link>
        </div>
      </div>

      {!authed && (
        <div style={styles.notice}>
          <strong>Note:</strong> You must log in to place or manage orders.
        </div>
      )}
    </div>
  );
}

const styles: Record<string, any> = {
  container: { maxWidth: 1100, margin: "0 auto", padding: 24 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  h1: { margin: 0, fontSize: 34 },
  sub: { marginTop: 6, color: "#555" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 18,
    background: "#fff",
  },
  cardTitle: { margin: 0, fontSize: 20 },
  cardText: { marginTop: 10, color: "#555" },
  primaryLink: {
    display: "inline-block",
    marginTop: 14,
    padding: "12px 14px",
    borderRadius: 10,
    background: "#111827",
    color: "#fff",
    fontWeight: 800,
    textDecoration: "none",
  },
  secondaryLink: {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    color: "#111",
    fontWeight: 800,
    textDecoration: "none",
  },
  ghostBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 800,
  },
  notice: {
    marginTop: 18,
    padding: 12,
    borderRadius: 14,
    background: "#fffbeb",
    border: "1px solid #fde68a",
  },
};