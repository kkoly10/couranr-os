"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useRouter } from "next/navigation";

type Delivery = {
  id: string;
  status: string;
  recipient_name: string;
  pickup_address: { address_line: string };
  dropoff_address: { address_line: string };
};

export default function DriverDeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "driver") {
        router.push("/");
        return;
      }

      const res = await fetch("/api/driver/my-deliveries");
      const data = await res.json();
      setDeliveries(data.deliveries || []);
      setLoading(false);
    }

    init();
  }, [router]);

  if (loading) return <p>Loading deliveries…</p>;

  if (!deliveries.length) {
    return <p>No assigned deliveries.</p>;
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>My Deliveries</h1>

      {deliveries.map((d) => (
        <div
          key={d.id}
          style={{
            border: "1px solid #ddd",
            padding: 16,
            marginBottom: 16,
            borderRadius: 8,
          }}
        >
          <p><strong>Status:</strong> {d.status}</p>
          <p><strong>Recipient:</strong> {d.recipient_name}</p>
          <p><strong>Pickup:</strong> {d.pickup_address.address_line}</p>
          <p><strong>Dropoff:</strong> {d.dropoff_address.address_line}</p>

          {d.status === "assigned" && (
            <button
              onClick={() =>
                fetch("/api/delivery/mark-in-transit", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ deliveryId: d.id }),
                }).then(() => location.reload())
              }
            >
              Start Delivery
            </button>
          )}
        </div>
      ))}
    </div>
  );
}