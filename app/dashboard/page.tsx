"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardHome() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!data.session) {
        setAuthed(false);
        setLoading(false);
        // Keep them on selector page with a login button
        return;
      }

      setAuthed(true);
      setLoading(false);
    }

    boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
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
          <p style={styles.sub}>
            Choose what you want to manage.
          </p>
        </div>

        {authed ? (
          <button onClick={logout} style={styles.ghostBtn}>
            Logout
          </button>
        ) : (
          <Link href="/login" style={styles.ghostLink}>
            Login
          </Link>
        )}
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>🚚 Deliveries</h2>
          <p style={styles.cardText}>
            Track deliveries, upload pickup photo, and view order history.
          </p>
          <Link href="/dashboard/delivery" style={styles.primaryLink}>
            Go to Delivery Dashboard
          </Link>
          <div style={{ height: 10 }} />
          <Link href="/courier" style={styles.secondaryLink}>
            Create a Delivery Quote
          </Link>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>🚗 Auto Rentals</h2>
          <p style={styles.cardText}>
            View your rentals, payments, agreements, and vehicle condition photos.
          </p>
          <Link href="/dashboard/auto" style={styles.primaryLink}>
            Go to Auto Dashboard
          </Link>
          <div style={{ height: 10 }} />
          <Link href="/auto/vehicles" style={styles.secondaryLink}>
            View Available Cars
          </Link>
        </div>
      </div>

      {!authed && (
        <div style={styles.notice}>
          <strong>Note:</strong> You’re not logged in. You can browse cars and get quotes,
          but you must log in to place an order or manage your dashboard.
        </div>
      )}
    </div>
  );
}

const styles: Record<string, any> = {
  container: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: 24,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 24,
  },
  h1: {
    margin: 0,
    fontSize: 34,
    letterSpacing: "-0.02em",
  },
  sub: {
    marginTop: 8,
    color: "#555",
    lineHeight: 1.5,
  },
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
  cardTitle: {
    margin: 0,
    fontSize: 20,
  },
  cardText: {
    marginTop: 10,
    color: "#555",
    lineHeight: 1.6,
  },
  primaryLink: {
    display: "inline-block",
    marginTop: 14,
    padding: "12px 14px",
    borderRadius: 10,
    background: "#111827",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 800,
  },
  secondaryLink: {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    textDecoration: "none",
    fontWeight: 800,
  },
  ghostBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  ghostLink: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 800,
    textDecoration: "none",
    color: "#111",
    display: "inline-block",
  },
  notice: {
    marginTop: 18,
    borderRadius: 14,
    padding: 12,
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
  },
};