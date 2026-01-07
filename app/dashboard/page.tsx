"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DeliveryRow = {
  id: string;
  status: string;
  createdAt: string;
  pickupAddress: string;
  dropoffAddress: string;
  order: {
    orderNumber: string;
    totalCents: number;
  };
};

export default function CustomerDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);

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

        const data = await res.json();
        setDeliveries(data.deliveries || []);
      } catch (err: any) {
        setError(err.message || "Failed to load deliveries");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  async function uploadPickupPhoto(deliveryId: string, file: File) {
    setUploading(deliveryId);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("deliveryId", deliveryId);

    const res = await fetch("/api/customer/upload-pickup-photo", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    if (!res.ok) {
      alert("Upload failed");
    } else {
      alert("Pickup photo uploaded");
    }

    setUploading(null);
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1>My deliveries</h1>

      {loading && <p>Loading deliveries…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {!loading &&
        deliveries.map((d) => (
          <div
            key={d.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              marginBottom: 14,
            }}
          >
            <strong>Order #{d.order.orderNumber}</strong>
            <p>Pickup: {d.pickupAddress}</p>
            <p>Drop-off: {d.dropoffAddress}</p>
            <p>
              Total: ${(d.order.totalCents / 100).toFixed(2)}
            </p>
            <p>Status: {d.status}</p>

            {(d.status === "pending" || d.status === "scheduled") && (
              <div style={{ marginTop: 10 }}>
                <label>
                  Upload pickup photo:
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploading === d.id}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        uploadPickupPhoto(d.id, e.target.files[0]);
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}