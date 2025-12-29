"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import Link from "next/link";

type DriverDelivery = {
  id: string;
  status: string;
  created_at: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  estimated_miles: number | null;
  weight_lbs: number | null;
  orders: {
    order_number: string | null;
  } | null;
};

const STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  in_transit: "In transit",
  completed: "Completed",
};

export default function DriverDashboard() {
  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<DriverDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeDelivery = useMemo(() => {
    return deliveries.find(
      (d) => d.status === "assigned" || d.status === "in_transit"
    );
  }, [deliveries]);

  const completedToday = useMemo(() => {
    const today = new Date().toDateString();
    return deliveries.filter(
      (d) =>
        d.status === "completed" &&
        new Date(d.created_at).toDateString() === today
    );
  }, [deliveries]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("deliveries")
        .select(
          `
          id,
          status,
          created_at,
          pickup_address,
          dropoff_address,
          estimated_miles,
          weight_lbs,
          orders (
            order_number
          )
        `
        )
        .eq("driver_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        setError(error.message);
        setDeliveries([]);
        setLoading(false);
        return;
      }

      setDeliveries((data ?? []) as DriverDelivery[]);
      setLoading(false);
    }

    load();
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={styles.h1}>Driver Dashboard</h1>
        <p style={styles.sub}>Loading your deliveries…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <h1 style={styles.h1}>Driver Dashboard</h1>
          <p style={styles.sub}>
            Focus on active deliveries and complete them safely.
          </p>
        </div>

        <div style={styles.driverBadge}>Driver</div>
      </div>

      {error && (
        <div style={{ ...styles.card, borderColor: "#fecaca" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ACTIVE DELIVERY */}
      <div style={{ marginTop: 24, ...styles.card }}>
        <h2 style={styles.sectionTitle}>Active Delivery</h2>

        {!activeDelivery && (
          <p style={{ marginTop: 10, color: "#555" }}>
            No active delivery assigned right now.
          </p>
        )}

        {activeDelivery && (
          <div style={{ marginTop: 14, ...styles.inner }}>
            <Info
              label="Order #"
              value={activeDelivery.orders?.order_number ?? "—"}
            />
            <Info
              label="Status"
              value={STATUS_LABELS[activeDelivery.status]}
            />
            <Info
              label="Pickup address"
              value={activeDelivery.pickup_address ?? "—"}
            />
            <Info
              label="Drop-off address"
              value={activeDelivery.dropoff_address ?? "—"}
            />
            <Info
              label="Estimated miles"
              value={activeDelivery.estimated_miles?.toFixed(2) ?? "—"}
            />
            <Info
              label="Weight"
              value={
                activeDelivery.weight_lbs
                  ? `${activeDelivery.weight_lbs} lbs`
                  : "—"
              }
            />

            <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
              {activeDelivery.status === "assigned" && (
                <PrimaryButton
                  href={`/driver/delivery/${activeDelivery.id}/pickup`}
                >
                  Upload pickup photo
                </PrimaryButton>
              )}

              {activeDelivery.status === "in_transit" && (
                <PrimaryButton
                  href={`/driver/delivery/${activeDelivery.id}/dropoff`}
                >
                  Upload drop-off photo
                </PrimaryButton>
              )}
            </div>
          </div>
        )}
      </div>

      {/* COMPLETED TODAY */}
      <div style={{ marginTop: 24, ...styles.card }}>
        <h2 style={styles.sectionTitle}>Completed Today</h2>

        {!completedToday.length && (
          <p style={{ marginTop: 10, color: "#555" }}>
            No deliveries completed today yet.
          </p>
        )}

        {completedToday.length > 0 && (
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {completedToday.map((d) => (
              <div key={d.id} style={styles.row}>
                <div>
                  <strong>{d.orders?.order_number ?? "Order"}</strong>
                  <div style={{ fontSize: 13, color: "#555" }}>
                    {new Date(d.created_at).toLocaleTimeString()}
                  </div>
                </div>

                <span style={styles.completedPill}>Completed</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SAFETY */}
      <div style={{ marginTop: 24, ...styles.card }}>
        <h2 style={styles.sectionTitle}>Safety reminders</h2>
        <ul style={{ marginTop: 10, color: "#555", lineHeight: 1.6 }}>
          <li>Always upload clear pickup and drop-off photos</li>
          <li>Do not leave items unattended unless marked “no signature”</li>
          <li>Contact support if a situation feels unsafe</li>
        </ul>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>
        {label}
      </div>
      <div style={{ fontWeight: 650 }}>{value}</div>
    </div>
  );
}

function PrimaryButton({ href, children }: any) {
  return (
    <Link
      href={href}
      style={{
        padding: "12px 18px",
        background: "#16a34a",
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

const styles: Record<string, any> = {
  h1: { margin: 0, fontSize: 34, letterSpacing: "-0.02em" },
  sub: { marginTop: 10, color: "#444" },
  driverBadge: {
    background: "#16a34a",
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
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
  },
  completedPill: {
    background: "#dcfce7",
    color: "#166534",
    padding: "6px 12px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
};