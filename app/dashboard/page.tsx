"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DeliveryRow = {
  id: string;
  status: string;
  createdAt: string;
  estimatedMiles: number | null;
  weightLbs: number | null;
  pickupAddress: string;
  dropoffAddress: string;
  order: {
    orderNumber: string;
    totalCents: number;
    status: string;
  };
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  assigned: "Driver assigned",
  in_transit: "In transit",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function CustomerDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      // 1️⃣ Ensure user is logged in
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      // 2️⃣ Fetch deliveries
      const res = await fetch("/api/customer/deliveries", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Failed to load deliveries");
        setLoading(false);
        return;
      }

      setDeliveries(data.deliveries || []);
      setLoading(false);
    }

    load();
  }, [router]);

  if (loading) {
    return (
      <div style={styles.container}>
        <h1 style={styles.h1}>My deliveries</h1>
        <p style={styles.sub}>Loading your deliveries…</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>My deliveries</h1>
          <p style={styles.sub}>
            Track your active and past deliveries
          </p>
        </div>
        <div style={styles.badge}>Customer</div>
      </div>

      {error && (
        <div style={{ ...styles.card, borderColor: "#fecaca" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!deliveries.length && !error && (
        <div style={styles.card}>
          <p style={{ color: "#555" }}>
            You don’t have any deliveries yet.
          </p>
          <button
            onClick={() => router.push("/courier")}
            style={styles.primaryBtn}
          >
            Get a delivery quote
          </button>
        </div>
      )}

      {deliveries.length > 0 && (
        <div style={{ marginTop: 24, display: "grid", gap: 16 }}>
          {deliveries.map((d) => (
            <div key={d.id} style={styles.card}>
              <div style={styles.rowTop}>
                <strong>{d.order.orderNumber}</strong>
                <span style={styles.statusPill}>
                  {STATUS_LABELS[d.status] ?? d.status}
                </span>
              </div>

              <div style={styles.meta}>
                <div>
                  <span style={styles.label}>Pickup</span>
                  <div>{d.pickupAddress}</div>
                </div>
                <div>
                  <span style={styles.label}>Drop-off</span>
                  <div>{d.dropoffAddress}</div>
                </div>
              </div>

              <div style={styles.meta}>
                <div>
                  <span style={styles.label}>Miles</span>
                  <div>
                    {d.estimatedMiles?.toFixed(2) ?? "—"}
                  </div>
                </div>
                <div>
                  <span style={styles.label}>Weight</span>
                  <div>
                    {d.weightLbs ? `${d.weightLbs} lbs` : "—"}
                  </div>
                </div>
                <div>
                  <span style={styles.label}>Total</span>
                  <div>
                    ${(d.order.totalCents / 100).toFixed(2)}
                  </div>
                </div>
              </div>

              <div style={styles.footer}>
                <div style={{ fontSize: 13, color: "#666" }}>
                  Created{" "}
                  {new Date(d.createdAt).toLocaleString()}
                </div>

                {d.status !== "completed" && (
                  <button
                    onClick={() =>
                      alert("Support requests coming next step")
                    }
                    style={styles.secondaryBtn}
                  >
                    Need help?
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- styles ---------------- */

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
  },
  h1: {
    margin: 0,
    fontSize: 34,
    letterSpacing: "-0.02em",
  },
  sub: {
    marginTop: 8,
    color: "#444",
  },
  badge: {
    background: "#2563eb",
    color: "#fff",
    padding: "8px 14px",
    borderRadius: 999,
    fontWeight: 700,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 20,
    background: "#fff",
  },
  rowTop: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  statusPill: {
    background: "#e5e7eb",
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  meta: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginTop: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "#6b7280",
  },
  footer: {
    marginTop: 16,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  primaryBtn: {
    marginTop: 12,
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryBtn: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
};