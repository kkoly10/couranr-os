"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

type DeliveryRow = {
  id: string;
  status: string;
  created_at: string;
  recipient_name: string | null;
  estimated_miles: number | null;
  weight_lbs: number | null;
  orders: {
    order_number: string | null;
    total_cents: number | null;
    status: string | null;
  } | null;
};

const STATUS_LABELS: Record<string, string> = {
  authorized: "Order confirmed",
  awaiting_pickup_photo: "Waiting for pickup photo",
  ready_for_dispatch: "Preparing for pickup",
  assigned: "Driver assigned",
  in_transit: "Out for delivery",
  completed: "Delivered",
};

function formatMoney(cents?: number | null) {
  if (!cents && cents !== 0) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function CustomerDashboard() {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeDelivery = useMemo(() => {
    return deliveries.find((d) => d.status !== "completed") ?? null;
  }, [deliveries]);

  const recentDeliveries = useMemo(() => {
    return deliveries.slice(0, 8);
  }, [deliveries]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setAuthed(false);
        setLoading(false);
        return;
      }

      setAuthed(true);

      // Pull recent deliveries for this customer via the related orders.customer_id
      // NOTE: This relies on your existing relationship and RLS allowing customer read.
      const { data, error: qErr } = await supabase
        .from("deliveries")
        .select(
          `
          id,
          status,
          created_at,
          recipient_name,
          estimated_miles,
          weight_lbs,
          orders (
            order_number,
            total_cents,
            status,
            customer_id
          )
        `
        )
        .eq("orders.customer_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12);

      if (qErr) {
        setError(qErr.message);
        setDeliveries([]);
        setLoading(false);
        return;
      }

      // Ensure orders exists
      const normalized = (data ?? []).filter((d: any) => d.orders);
      setDeliveries(normalized as DeliveryRow[]);
      setLoading(false);
    }

    load();
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={styles.h1}>Dashboard</h1>
        <p style={styles.sub}>Loading your account…</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div style={{ maxWidth: 900 }}>
        <h1 style={styles.h1}>Dashboard</h1>
        <p style={styles.sub}>
          Please log in to view your orders and receipts.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <PrimaryButton href="/login">Login</PrimaryButton>
          <SecondaryButton href="/signup">Create account</SecondaryButton>
        </div>

        <div style={{ marginTop: 28, ...styles.card }}>
          <div style={{ fontWeight: 650 }}>What you’ll see here</div>
          <ul style={{ marginTop: 10, color: "#555", lineHeight: 1.6 }}>
            <li>Active delivery status</li>
            <li>Past order history</li>
            <li>Receipts</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1050 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={styles.h1}>My Dashboard</h1>
          <p style={styles.sub}>
            Track active deliveries, view history, and download receipts.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <PrimaryButton href="/courier">New delivery</PrimaryButton>
          <SecondaryButton href="/docs">Docs service</SecondaryButton>
        </div>
      </div>

      {error && (
        <div style={{ ...styles.card, borderColor: "#fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 650, color: "#991b1b" }}>Couldn’t load your orders</div>
          <div style={{ marginTop: 6, color: "#7f1d1d" }}>{error}</div>
        </div>
      )}

      {/* Active Order */}
      <div style={{ marginTop: 22, ...styles.card }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={styles.sectionTitle}>Active Order</div>
            <div style={{ color: "#555", marginTop: 6 }}>
              {activeDelivery ? "Your current delivery is in progress." : "No active deliveries right now."}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link href="/delivery/status" style={styles.link}>
              View status
            </Link>
          </div>
        </div>

        {activeDelivery && (
          <div style={{ marginTop: 16, ...styles.inner }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <Info label="Order #" value={activeDelivery.orders?.order_number ?? "—"} />
              <Info label="Status" value={STATUS_LABELS[activeDelivery.status] ?? activeDelivery.status} />
              <Info label="Total" value={formatMoney(activeDelivery.orders?.total_cents)} />
              <Info label="Created" value={formatDate(activeDelivery.created_at)} />
              <Info label="Miles" value={activeDelivery.estimated_miles?.toFixed(2) ?? "—"} />
              <Info label="Weight (lbs)" value={activeDelivery.weight_lbs?.toString() ?? "—"} />
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <PrimaryButton href="/delivery/status">Open live status</PrimaryButton>
              <SecondaryButton href="/courier/special-request">Special request</SecondaryButton>
            </div>
          </div>
        )}
      </div>

      {/* History */}
      <div style={{ marginTop: 22, ...styles.card }}>
        <div style={styles.sectionTitle}>Recent Orders</div>
        <div style={{ color: "#555", marginTop: 6 }}>
          Your most recent deliveries and receipts.
        </div>

        {!recentDeliveries.length ? (
          <div style={{ marginTop: 16, color: "#666" }}>
            No orders yet. Start your first delivery.
          </div>
        ) : (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {recentDeliveries.map((d) => (
              <div key={d.id} style={styles.row}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontWeight: 650 }}>
                    {d.orders?.order_number ?? "Order"}
                    <span style={{ marginLeft: 10, ...pillForStatus(d.status) }}>
                      {STATUS_LABELS[d.status] ?? d.status}
                    </span>
                  </div>
                  <div style={{ color: "#666", fontSize: 13 }}>
                    {formatDate(d.created_at)} • {d.estimated_miles?.toFixed(2) ?? "—"} mi •{" "}
                    {d.weight_lbs ?? "—"} lbs
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontWeight: 650 }}>{formatMoney(d.orders?.total_cents)}</div>
                  <Link href="/delivery/status" style={styles.link}>
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Help */}
      <div style={{ marginTop: 22, ...styles.card }}>
        <div style={styles.sectionTitle}>Need help?</div>
        <div style={{ color: "#555", marginTop: 6, lineHeight: 1.6 }}>
          For oversized, fragile, high-value, or unusual deliveries, submit a Special Request so we can confirm feasibility and pricing.
        </div>

        <div style={{ marginTop: 14 }}>
          <SecondaryButton href="/courier/special-request">
            Special request form
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 6, fontWeight: 650 }}>{value}</div>
    </div>
  );
}

function pillForStatus(status: string) {
  if (status === "completed") {
    return {
      display: "inline-block",
      fontSize: 12,
      padding: "3px 10px",
      borderRadius: 999,
      background: "#dcfce7",
      color: "#166534",
      fontWeight: 650,
    } as const;
  }
  if (status === "in_transit" || status === "assigned") {
    return {
      display: "inline-block",
      fontSize: 12,
      padding: "3px 10px",
      borderRadius: 999,
      background: "#dbeafe",
      color: "#1e40af",
      fontWeight: 650,
    } as const;
  }
  return {
    display: "inline-block",
    fontSize: 12,
    padding: "3px 10px",
    borderRadius: 999,
    background: "#f3f4f6",
    color: "#111827",
    fontWeight: 650,
  } as const;
}

function PrimaryButton({ href, children }: any) {
  return (
    <Link
      href={href}
      style={{
        padding: "12px 16px",
        background: "#2563eb",
        color: "#fff",
        borderRadius: 10,
        fontWeight: 650,
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ href, children }: any) {
  return (
    <Link
      href={href}
      style={{
        padding: "12px 16px",
        border: "1px solid #d1d5db",
        borderRadius: 10,
        fontWeight: 650,
        textDecoration: "none",
        color: "#111",
        display: "inline-block",
        background: "#fff",
      }}
    >
      {children}
    </Link>
  );
}

const styles: Record<string, any> = {
  h1: {
    margin: 0,
    fontSize: 34,
    letterSpacing: "-0.02em",
  },
  sub: {
    marginTop: 10,
    color: "#444",
    maxWidth: 760,
    lineHeight: 1.6,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 20,
    background: "#fff",
  },
  sectionTitle: {
    fontWeight: 800,
    fontSize: 14,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    color: "#111",
  },
  inner: {
    border: "1px solid #eef2f7",
    borderRadius: 14,
    padding: 16,
    background: "#fbfdff",
  },
  row: {
    border: "1px solid #eef2f7",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
  },
  link: {
    color: "#2563eb",
    fontWeight: 650,
    textDecoration: "none",
  },
};