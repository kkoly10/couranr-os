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
    status: string;
  };
};

export default function CustomerDashboard() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Debug so you can SEE if the API is returning what we expect
  const [debug, setDebug] = useState<any>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      try {
        const res = await fetch("/api/customer/deliveries", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
        });

        const text = await res.text();

        // If it returns HTML, you're not hitting the route you think you are.
        // (e.g. 404 page)
        if (text.trim().startsWith("<!DOCTYPE html")) {
          throw new Error("API returned HTML (likely 404). Check route path: /api/customer/deliveries");
        }

        const json = JSON.parse(text);
        setDebug(json);

        if (!res.ok) {
          throw new Error(json?.error || "Failed to load deliveries");
        }

        setDeliveries(json.deliveries || []);
      } catch (e: any) {
        setError(e?.message || "Failed to load deliveries");
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

        <button onClick={() => router.push("/courier")} style={styles.primaryBtn}>
          New delivery
        </button>
      </div>

      {loading && <p>Loading deliveries…</p>}

      {error && (
        <div style={{ ...styles.card, borderColor: "#fecaca" }}>
          <strong>Error:</strong> {error}
          <div style={{ marginTop: 10 }}>
            <button
              style={styles.secondaryBtn}
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
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
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong>{d.order.orderNumber}</strong>
              <span style={pill(d.status)}>{d.status}</span>
            </div>
            <p style={styles.line}><strong>Pickup:</strong> {d.pickupAddress}</p>
            <p style={styles.line}><strong>Drop-off:</strong> {d.dropoffAddress}</p>
            <p style={styles.line}>
              <strong>Total:</strong> ${(d.order.totalCents / 100).toFixed(2)}
            </p>
          </div>
        ))}

      {/* Debug viewer (remove later) */}
      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Debug: API response</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 10, fontSize: 12 }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const styles: Record<string, any> = {
  container: { maxWidth: 1100, margin: "0 auto", padding: 24 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  h1: { margin: 0, fontSize: 32 },
  sub: { marginTop: 6, color: "#555" },
  card: { border: "1px solid #e5e7eb", borderRadius: 14, padding: 16, background: "#fff", marginBottom: 12 },
  primaryBtn: { padding: "10px 16px", borderRadius: 10, border: "none", background: "#111827", color: "#fff", fontWeight: 700, cursor: "pointer" },
  secondaryBtn: { padding: "8px 12px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", fontWeight: 700, cursor: "pointer" },
  line: { margin: "8px 0" },
};

function pill(status: string): React.CSSProperties {
  const s = (status || "").toLowerCase();
  const base: React.CSSProperties = {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    border: "1px solid #e5e7eb",
  };
  if (s === "pending") return { ...base, background: "#fff7ed", borderColor: "#fed7aa" };
  if (s === "paid") return { ...base, background: "#ecfeff", borderColor: "#a5f3fc" };
  if (s === "completed") return { ...base, background: "#ecfdf5", borderColor: "#a7f3d0" };
  if (s === "cancelled") return { ...base, background: "#fef2f2", borderColor: "#fecaca" };
  return base;
}