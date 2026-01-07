"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DeliveryRow = {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  order: {
    orderNumber: string;
    totalCents: number;
  };
};

export default function CustomerDashboard() {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      try {
        const res = await fetch("/api/customer/deliveries", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!res.ok) throw new Error("Failed to load deliveries");

        const data = await res.json();
        setDeliveries(data.deliveries || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  async function uploadPickupPhoto(deliveryId: string, file: File) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    const formData = new FormData();
    formData.append("deliveryId", deliveryId);
    formData.append("file", file);

    await fetch("/api/customer/upload-pickup-photo", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    alert("Pickup photo uploaded");
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <h1>My Deliveries</h1>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {!loading &&
        deliveries.map((d) => (
          <div
            key={d.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <strong>Order {d.order.orderNumber}</strong>
            <p>Pickup: {d.pickupAddress}</p>
            <p>Drop-off: {d.dropoffAddress}</p>
            <p>Total: ${(d.order.totalCents / 100).toFixed(2)}</p>

            <label style={{ display: "block", marginTop: 12 }}>
              Upload pickup photo:
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    uploadPickupPhoto(d.id, e.target.files[0]);
                  }
                }}
              />
            </label>
          </div>
        ))}
    </div>
  );
}