"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

/* ---------------- TYPES ---------------- */

type OrderInfo = {
  order_number: string;
  total_cents: number;
  status: string;
};

type DeliveryRow = {
  id: string;
  status: string;
  created_at: string;
  recipient_name: string | null;
  estimated_miles: number;
  weight_lbs: number;
  order: OrderInfo | null;
};

/* --------------- COMPONENT -------------- */

export default function CustomerDashboard() {
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDeliveries() {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("deliveries")
        .select(`
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
        `)
        .eq("orders.customer_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      // ✅ Normalize Supabase relation array → single object
      const normalized: DeliveryRow[] = (data ?? []).map((d: any) => ({
        id: d.id,
        status: d.status,
        created_at: d.created_at,
        recipient_name: d.recipient_name,
        estimated_miles: d.estimated_miles,
        weight_lbs: d.weight_lbs,
        order: d.orders && d.orders.length > 0 ? {
          order_number: d.orders[0].order_number,
          total_cents: d.orders[0].total_cents,
          status: d.orders[0].status,
        } : null,
      }));

      setDeliveries(normalized);
      setLoading(false);
    }

    loadDeliveries();
  }, []);

  /* --------------- UI STATES -------------- */

  if (loading) {
    return <div style={{ padding: 24 }}>Loading your deliveries…</div>;
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
        My Deliveries
      </h1>

      {deliveries.length === 0 && (
        <p>You don’t have any deliveries yet.</p>
      )}

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
          <strong>Recipient:</strong> {d.recipient_name || "—"}
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
              <br />
              <strong>Payment status:</strong> {d.order.status}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
