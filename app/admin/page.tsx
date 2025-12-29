"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import Link from "next/link";

type AdminDelivery = {
  id: string;
  status: string;
  created_at: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  estimated_miles: number | null;
  weight_lbs: number | null;
  orders: {
    order_number: string | null;
    total_cents: number | null;
    customer_id: string | null;
  } | null;
};

const STATUS_LABELS: Record<string, string> = {
  authorized: "Authorized",
  awaiting_pickup_photo: "Waiting pickup photo",
  ready_for_dispatch: "Ready for dispatch",
  assigned: "Assigned",
  in_transit: "In transit",
  completed: "Completed",
};

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<AdminDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("deliveries")
        .select(
          `
          id,
          status,
          created_at,
          driver_id,
          pickup_address,
          dropoff_address,
          estimated_miles,
          weight_lbs,
          orders (
            order_number,
            total_cents,
            customer_id
          )
        `
        )
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        setError(error.message);
        setDeliveries([]);
        setLoading(false);
        return;
      }

      setDeliveries((data ?? []) as AdminDelivery[]);
      setLoading(false);
    }

    load();
  }, []);

  const activeDeliveries = useMemo(
    () => deliveries.filter((d) => d.status !== "completed"),
    [deliveries]
  );

  const unassigned = useMemo(
    () => deliveries.filter((d) => d.status === "ready_for_dispatch"),
    [deliveries]
  );

  const inTransit = useMemo(
    () => deliveries.filter((d) => d.status === "in_transit"),
    [deliveries]
  );

  const completedToday = useMemo(() => {
    const today = new Date().toDateString();
    return deliveries.filter(
      (d) =>
        d.status === "completed" &&
        new Date(d.created_at).toDateString() === today
    );
  }, [deliveries]);

  if (loading) {
    return (
      <div>
        <h1 style={styles.h1}>Admin Dashboard</h1>
        <p style={styles.sub}>Loading system status…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <h1 style={styles.h1}>Admin Dashboard</h1>
          <p style={styles.sub}>
            Monitor deliveries, drivers, and intervene when needed.
          </p>
        </div>

        <div style={styles.adminBadge}>Admin</div>
      </div>

      {error && (
        <div style={{ ...styles.card, borderColor: "#fecaca" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* KPI STRIP */}
      <div style={styles.kpiGrid}>
        <KPI label="Active deliveries" value={activeDeliveries.length} />
        <KPI label="Unassigned" value={unassigned.length} />
        <KPI label="In transit" value={inTransit.length} />
        <KPI label="Completed today" value={completedToday.length} />
      </div>

      {/* UNASSIGNED */}
      <Section
        title="Awaiting Assignment"
        subtitle="Orders ready but not yet assigned to a driver."
      >
        {unassigned.length === 0 && <Empty text="No unassigned deliveries." />}
        {unassigned.map((d) => (
          <AdminRow key={d.id} delivery={d} />
        ))}
      </Section>

      {/* IN TRANSIT */}
      <Section
        title="In Transit"
        subtitle="Deliveries currently being executed."
      >
        {inTransit.length === 0 && <Empty text="No deliveries in transit." />}
        {inTransit.map((d) => (
          <AdminRow key={d.id} delivery={d} />
        ))}
      </Section>

      {/* COMPLETED */}
      <Section
        title="Completed Today"
        subtitle="Successfully completed deliveries today."
      >
        {completedToday.length === 0 && <Empty text="No completed deliveries today." />}
        {completedToday.map((d) => (
          <AdminRow key={d.id} delivery={d} />
        ))}
      </Section>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.kpiCard}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280" }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 26 }}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <p style={{ marginTop: 4, color: "#555" }}>{subtitle}</p>
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: "#666" }}>{text}</div>;
}

function AdminRow({ delivery }: { delivery: AdminDelivery }) {
  return (
    <div style={styles.row}>
      <div>
        <strong>{delivery.orders?.order_number ?? "Order"}</strong>
        <div style={{ fontSize: 13, color: "#555" }}>
          {STATUS_LABELS[delivery.status] ?? delivery.status}
        </div>
        <div style={{ fontSize: 13, color: "#555" }}>
          {delivery.estimated_miles?.toFixed(2) ?? "—"} mi •{" "}
          {delivery.weight_lbs ?? "—"} lbs
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <div style={{ fontWeight: 650 }}>
          {delivery.driver_id ? "Driver assigned" : "No driver"}
        </div>
        <Link
          href={`/admin/delivery/${delivery.id}`}
          style={styles.link}
        >
          View
        </Link>
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  h1: { margin: 0, fontSize: 34, letterSpacing: "-0.02em" },
  sub: { marginTop: 10, color: "#444" },
  adminBadge: {
    background: "#7c3aed",
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
  kpiGrid: {
    marginTop: 26,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 16,
  },
  kpiCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 16,
    background: "#fafafa",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: "-0.01em",
  },
  row: {
    border: "1px solid #eef2f7",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
    display: "flex",
    justifyContent: "space-between",
  },
  link: {
    color: "#2563eb",
    fontWeight: 650,
    textDecoration: "none",
  },
};