"use client";

import { useEffect, useState } from "react";

const STATUS_LABELS: Record<string, string> = {
  authorized: "Order confirmed",
  awaiting_pickup_photo: "Waiting for pickup photo",
  ready_for_dispatch: "Preparing for pickup",
  assigned: "Driver assigned",
  in_transit: "Out for delivery",
  completed: "Delivered",
};

export default function DeliveryStatusPage() {
  const [delivery, setDelivery] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/customer/delivery")
      .then((res) => res.json())
      .then((data) => {
        setDelivery(data.delivery);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading delivery status…</p>;

  if (!delivery) {
    return <p>No active delivery found.</p>;
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Delivery Status</h1>

      <p>
        <strong>Order:</strong> {delivery.orders.order_number}
      </p>

      <p>
        <strong>Status:</strong>{" "}
        {STATUS_LABELS[delivery.status] || delivery.status}
      </p>

      <p>
        <strong>Distance:</strong> {delivery.estimated_miles} miles
      </p>

      <p>
        <strong>Weight:</strong> {delivery.weight_lbs} lbs
      </p>

      {delivery.status === "completed" && (
        <div style={{ marginTop: 16 }}>
          <h3>Receipt</h3>
          <p>Total Paid: ${(delivery.orders.total_cents / 100).toFixed(2)}</p>
        </div>
      )}
    </div>
  );
}