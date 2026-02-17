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

export default function DeliveryDashboard() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login?next=/dashboard/delivery");
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch("/api/customer/deliveries", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || "Failed to load deliveries");
        }

        const data = await res.json();
        setDeliveries(data.deliveries || []);
      } catch (err: any) {
        setError(
          err?.name === "AbortError" ? "Request timed out. Please refresh." : err.message || "Failed to load deliveries"
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">My deliveries</h1>
          <p className="pageSub">Track your active and past deliveries.</p>
        </div>

        <button onClick={() => router.push("/courier")} className="btn btnPrimary">
          New delivery
        </button>
      </div>

      {loading && <p className="muted">Loading deliveries…</p>}

      {error && (
        <div className="notice noticeError">
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && deliveries.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            You don’t have any deliveries yet.
          </p>
        </div>
      )}

      {!loading &&
        !error &&
        deliveries.map((d) => (
          <div key={d.id} className="card">
            <div className="rowBetween">
              <strong>{d.order.orderNumber || "—"}</strong>
              <span className="pill">{d.status}</span>
            </div>

            <div className="kv">
              <div>
                <div className="k">Pickup</div>
                <div className="v">{d.pickupAddress || "—"}</div>
              </div>
              <div>
                <div className="k">Drop-off</div>
                <div className="v">{d.dropoffAddress || "—"}</div>
              </div>
              <div>
                <div className="k">Total</div>
                <div className="v">${(d.order.totalCents / 100).toFixed(2)}</div>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}