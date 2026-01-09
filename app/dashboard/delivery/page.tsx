"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DeliveryRow = {
  id: string;
  status: string;
  createdAt: string;
  pickupAddress: string;
  dropoffAddress: string;
  order: {
    orderNumber: string;
    totalCents: number;
  };
};

export default function DeliveryDashboard() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login?next=/dashboard/delivery");
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch("/api/customer/deliveries", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || "Failed to load deliveries");
        }

        const data = await res.json();
        setDeliveries(data.deliveries || []);
      } catch (err: any) {
        setError(
          err?.name === "AbortError"
            ? "Request timed out. Please refresh."
            : err.message || "Failed to load deliveries"
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>My deliveries</h1>
          <p style={styles.sub}>Track your active and past deliveries</p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => router.push("/courier")} style={styles.primaryBtn}>
            New delivery
          </button>
          <button onClick={() => router.push("/dashboard")} style={styles.ghostBtn}>
            Back to dashboards
          </button>
        </div>
      </div>

      {loading && <p>Loading deliveries…</p>}

      {error && (
        <div style={{ ...styles.card, borderColor: "#fecaca" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && deliveries.length === 0 && (
        <div style={styles.card}>
          <p>You don’t have any deliveries yet.</p>
        </div>
      )}

      {!loading &&
        !error &&
        deliveries.map((d) => (
          <div key={d.id} style={styles.card}>
            <strong>{d.order.orderNumber || "—"}</strong>
            <p>Pickup: {d.pickupAddress || "—"}</p>
            <p>Drop-off: {d.dropoffAddress || "—"}</p>
            <p>Total: ${(d.order.totalCents / 100).toFixed(2)}</p>
            <p>Status: {d.status}</p>
          </div>
        ))}
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
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
    flexWrap: "wrap",
  },
  h1: {
    margin: 0,
    fontSize: 32,
  },
  sub: {
    marginTop: 6,
    color: "#555",
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 16,
    background: "#fff",
    marginBottom: 12,
  },
  primaryBtn: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  ghostBtn: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    fontWeight: 800,
    cursor: "pointer",
  },
};