"use client";

import { useEffect, useState } from "react";

type Delivery = {
  id: string;
  status: string;
  driver_id: string | null;
  recipient_name: string;
  pickup_address: { address_line: string };
  dropoff_address: { address_line: string };
  orders: { order_number: string };
};

export default function AdminDeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/deliveries")
      .then((res) => res.json())
      .then((data) => {
        setDeliveries(data.deliveries || []);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading deliveries…</p>;

  return (
    <div style={{ padding: 24 }}>
      <h1>Admin — Deliveries</h1>

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
          <p><strong>Order:</strong> {d.orders.order_number}</p>
          <p><strong>Status:</strong> {d.status}</p>
          <p><strong>Recipient:</strong> {d.recipient_name}</p>
          <p><strong>Pickup:</strong> {d.pickup_address.address_line}</p>
          <p><strong>Dropoff:</strong> {d.dropoff_address.address_line}</p>
          <p>
            <strong>Driver:</strong>{" "}
            {d.driver_id ? d.driver_id : "Unassigned"}
          </p>

          <button
            onClick={() => {
              const driverId = prompt("Enter driver user ID");
              if (!driverId) return;

              fetch("/api/delivery/assign-driver", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  deliveryId: d.id,
                  driverId,
                }),
              }).then(() => location.reload());
            }}
          >
            Assign / Reassign Driver
          </button>
        </div>
      ))}
    </div>
  );
}