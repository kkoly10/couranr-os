"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/* ---------------- TYPES ---------------- */

type AdminOrder = {
  order_number: string;
  total_cents: number;
  customer_id: string;
};

type AdminDelivery = {
  id: string;
  status: string;
  created_at: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  estimated_miles: number;
  weight_lbs: number;
  order: AdminOrder | null;
};

/* --------------- COMPONENT -------------- */

export default function AdminDashboard() {
  const [deliveries, setDeliveries] = useState<AdminDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDeliveries() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("deliveries")
        .select(`
          id,
          status,
          created_at,
          driver_id,
          estimated_miles,
          weight_lbs,
          pickup_address:pickup_address_id (
            address_line
          ),
          dropoff_address:dropoff_address_id (
            address_line
          ),
          orders (
            order_number,
            total_cents,
            customer_id
          )
        `)
        .order("created_at", { ascending: false });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      const normalized: AdminDelivery[] = (data ?? []).map((d: any) => ({
        id: d.id,
        status: d.status,
        created_at: d.created_at,
        driver_id: d.driver_id,
        estimated_miles: d.estimated_miles,
        weight_lbs: d.weight_lbs,
        pickup_address: d.pickup_address?.address_line ?? "—",
        dropoff_address: d.dropoff_address?.address_line ?? "—",
        order: d.orders && d.orders.length > 0 ? d.orders[0] : null,
      }));

      setDeliveries(normalized);
      setLoading(false);
    }

    loadDeliveries();
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Loading admin dashboard…</div>;

  if (error) {
    return (
      <div style={{ padding: 24, color: "red" }}>
        Failed to load deliveries: {error}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Admin</h1>
          <p style={{ marginTop: 8, color: "#555" }}>
            Admin tools are separate from the customer dashboard.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link
            href="/admin"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "#111827",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            Deliveries
          </Link>

          <Link
            href="/admin/auto"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111827",
              color: "#111827",
              textDecoration: "none",
              fontWeight: 900,
              background: "#fff",
            }}
          >
            Auto Admin
          </Link>

          <Link
            href="/dashboard/home"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              color: "#111827",
              textDecoration: "none",
              fontWeight: 900,
              background: "#fff",
            }}
          >
            Customer view
          </Link>
        </div>
      </div>

      <hr style={{ margin: "18px 0" }} />

      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Deliveries</h2>

      {deliveries.length === 0 && <p>No deliveries found.</p>}

      {deliveries.map((d) => (
        <div
          key={d.id}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 16,
            marginBottom: 12,
            background: "#fff",
          }}
        >
          <strong>Status:</strong> {d.status}
          <br />
          <strong>Pickup:</strong> {d.pickup_address}
          <br />
          <strong>Dropoff:</strong> {d.dropoff_address}
          <br />
          <strong>Miles:</strong> {d.estimated_miles}
          <br />
          <strong>Weight:</strong> {d.weight_lbs} lbs
          <br />

          {d.order && (
            <>
              <strong>Order #:</strong> {d.order.order_number}
              <br />
              <strong>Total:</strong> ${(d.order.total_cents / 100).toFixed(2)}
            </>
          )}
        </div>
      ))}
    </div>
  );
}