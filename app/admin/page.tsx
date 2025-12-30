"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

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

      const { data, error } = await supabase
        .from("deliveries")
        .select(`
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
        `)
        .order("created_at", { ascending: false });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      // 🔑 Normalize Supabase relation array → single object
      const normalized: AdminDelivery[] = (data ?? []).map((d: any) => ({
        id: d.id,
        status: d.status,
        created_at: d.created_at,
        driver_id: d.driver_id,
        pickup_address: d.pickup_address,
        dropoff_address: d.dropoff_address,
        estimated_miles: d.estimated_miles,
        weight_lbs: d.weight_lbs,
        order: d.orders && d.orders.length > 0 ? d.orders[0] : null,
      }));

      setDeliveries(normalized);
      setLoading(false);
    }

    loadDeliveries();
  }, []);

  /* --------------- UI STATES -------------- */

  if (loading) {
    return <div style={{ padding: 24 }}>Loading admin dashboard…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: "red" }}>
        Failed to load deliveries: {error}
      </div>
    );
  }

  /* ----------------- UI ------------------ */

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 16 }}>
        Admin — Deliveries
      </h1>

      {deliveries.length === 0 && <p>No deliveries found.</p>}

      {deliveries.map((d) => (
        <div
          key={d.id}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
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
              <strong>Total:</strong> $
              {(d.order.total_cents / 100).toFixed(2)}
            </>
          )}
        </div>
      ))}
    </div>
  );
}