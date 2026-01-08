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

  recipientName: string;
  recipientPhone: string;
  deliveryNotes: string | null;

  order: {
    orderNumber: string;
    totalCents: number;
    status?: string;
  };

  hasPickupPhoto: boolean;
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

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
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

        <button onClick={() => router.push("/courier")} style={styles.primaryBtn}>
          New delivery
        </button>
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
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 16 }}>{d.order.orderNumber || "Order"}</strong>
              <span style={pill(d.status)}>{d.status}</span>
            </div>

            <div style={{ marginTop: 10 }}>
              <div><strong>Pickup:</strong> {d.pickupAddress}</div>
              <div><strong>Drop-off:</strong> {d.dropoffAddress}</div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div><strong>Recipient:</strong> {d.recipientName} • {d.recipientPhone}</div>
              {d.deliveryNotes ? (
                <div style={{ marginTop: 6, color: "#374151" }}>
                  <strong>Notes:</strong> {d.deliveryNotes}
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 10 }}>
              <strong>Total:</strong> ${(d.order.totalCents / 100).toFixed(2)}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {!d.hasPickupPhoto && (
                <button
                  onClick={() =>
                    router.push(`/courier/confirmation?deliveryId=${encodeURIComponent(d.id)}`)
                  }
                  style={styles.ghostBtn}
                >
                  Upload pickup photo
                </button>
              )}

              <a
                href={`mailto:support@couranr.com?subject=${encodeURIComponent(
                  `Help with ${d.order.orderNumber || "delivery"}`
                )}`}
                style={{ ...styles.ghostBtn, display: "inline-block", textDecoration: "none" }}
              >
                Request help
              </a>
            </div>
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
    marginBottom: 24,
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
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
};

function pill(status: string) {
  const s = (status || "").toLowerCase();
  let bg = "#eef2ff";
  let fg = "#3730a3";
  if (s.includes("pending")) {
    bg = "#fffbeb"; fg = "#92400e";
  } else if (s.includes("active") || s.includes("assigned")) {
    bg = "#ecfeff"; fg = "#155e75";
  } else if (s.includes("delivered") || s.includes("complete")) {
    bg = "#ecfdf5"; fg = "#166534";
  } else if (s.includes("cancel")) {
    bg = "#fef2f2"; fg = "#991b1b";
  }
  return {
    padding: "6px 10px",
    borderRadius: 999,
    background: bg,
    color: fg,
    fontWeight: 800,
    fontSize: 12,
    border: "1px solid #e5e7eb",
  } as any;
}
