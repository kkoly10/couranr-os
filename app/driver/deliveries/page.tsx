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
  created_at?: string;
};

export default function DriverDeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        setLoading(true);
        setError(null);

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.push("/login?next=/driver/deliveries");
          return;
        }

        // Optional: quick client-side role guard (server already guards too)
        const { data: profile, error: pErr } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        if (pErr) throw new Error(pErr.message);

        if (profile?.role !== "driver") {
          router.push("/");
          return;
        }

        const res = await fetch("/api/driver/my-deliveries", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(json?.error || `Failed to load deliveries (${res.status})`);
        }

        if (!mounted) return;
        setDeliveries(json.deliveries || []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load deliveries");
        setDeliveries([]);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, [router]);

  async function startDelivery(deliveryId: string) {
    try {
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login?next=/driver/deliveries");
        return;
      }

      const res = await fetch("/api/delivery/mark-in-transit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ deliveryId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Failed to start delivery");
      }

      // Reload
      const reload = await fetch("/api/driver/my-deliveries", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const reloadJson = await reload.json().catch(() => ({}));
      setDeliveries(reloadJson.deliveries || []);
    } catch (e: any) {
      setError(e?.message || "Failed to start delivery");
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading deliveries…</p>;

  return (
    <div style={{ padding: 24 }}>
      <h1>My Deliveries</h1>

      {error && (
        <div
          style={{
            marginTop: 12,
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fff1f2",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {!deliveries.length && !error && <p>No assigned deliveries.</p>}

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
          <p>
            <strong>Status:</strong> {d.status}
          </p>
          <p>
            <strong>Recipient:</strong> {d.recipient_name}
          </p>
          <p>
            <strong>Pickup:</strong> {d.pickup_address?.address_line ?? "—"}
          </p>
          <p>
            <strong>Dropoff:</strong> {d.dropoff_address?.address_line ?? "—"}
          </p>

          {d.status === "assigned" && (
            <button onClick={() => startDelivery(d.id)}>Start Delivery</button>
          )}
        </div>
      ))}
    </div>
  );
}