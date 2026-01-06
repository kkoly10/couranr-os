"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function CustomerDashboard() {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: session } = await supabase.auth.getSession();

      if (!session?.session?.access_token) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/customer/deliveries", {
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
        },
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to load deliveries");
      } else {
        setDeliveries(json.deliveries ?? []);
      }

      setLoading(false);
    }

    load();
  }, []);

  if (loading) return <p>Loading deliveries…</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>My Deliveries</h1>

      {deliveries.length === 0 ? (
        <p>No deliveries yet.</p>
      ) : (
        <ul style={{ marginTop: 16 }}>
          {deliveries.map((d) => (
            <li
              key={d.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <strong>Order #{d.orderNumber}</strong>
              <div>Status: {d.status}</div>
              <div>Pickup: {d.pickup}</div>
              <div>Dropoff: {d.dropoff}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}