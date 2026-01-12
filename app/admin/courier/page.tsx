"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Delivery = {
  id: string;
  status: string;
  created_at: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  customer_id: string | null;
  driver_id: string | null;
};

type Driver = { id: string; email: string; role: string };

export default function AdminCourierPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [onlyUnassigned, setOnlyUnassigned] = useState(true);

  async function apiFetch(path: string, init?: RequestInit) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Not authenticated");

    const res = await fetch(path, {
      ...(init || {}),
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Request failed");
    return json;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch(`/api/admin/courier/deliveries?unassigned=${onlyUnassigned ? "1" : "0"}`);
      setDeliveries(d.deliveries || []);

      const dr = await apiFetch(`/api/admin/drivers`);
      setDrivers(dr.drivers || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyUnassigned]);

  const unassigned = useMemo(() => deliveries.filter((d) => !d.driver_id && d.status !== "cancelled"), [deliveries]);
  const assigned = useMemo(() => deliveries.filter((d) => !!d.driver_id && d.status !== "cancelled"), [deliveries]);
  const cancelled = useMemo(() => deliveries.filter((d) => d.status === "cancelled"), [deliveries]);

  async function assign(deliveryId: string, driverId: string) {
    try {
      await apiFetch(`/api/admin/courier/deliveries/${deliveryId}/assign-driver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId }),
      });
      await load();
    } catch (e: any) {
      alert(e?.message || "Assign failed");
    }
  }

  async function unassign(deliveryId: string) {
    try {
      await apiFetch(`/api/admin/courier/deliveries/${deliveryId}/unassign-driver`, { method: "POST" });
      await load();
    } catch (e: any) {
      alert(e?.message || "Unassign failed");
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32 }}>Admin • Courier Dispatch</h1>
          <p style={{ marginTop: 6, color: "#555" }}>
            Assign drivers, edit delivery details, cancel/reinstate safely (with audit logs).
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
            <input type="checkbox" checked={onlyUnassigned} onChange={() => setOnlyUnassigned(!onlyUnassigned)} />
            Show only unassigned
          </label>

          <button
            onClick={load}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 700 }}
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</p>}

      {!loading && !error && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18, marginTop: 18 }}>
          <Section title={`Unassigned (${unassigned.length})`}>
            {unassigned.map((d) => (
              <DeliveryCard
                key={d.id}
                d={d}
                drivers={drivers}
                onAssign={assign}
                onOpen={() => router.push(`/admin/courier/${d.id}`)}
              />
            ))}
            {unassigned.length === 0 && <Empty />}
          </Section>

          <Section title={`Assigned (${assigned.length})`}>
            {assigned.map((d) => (
              <DeliveryCard
                key={d.id}
                d={d}
                drivers={drivers}
                onUnassign={unassign}
                onOpen={() => router.push(`/admin/courier/${d.id}`)}
              />
            ))}
            {assigned.length === 0 && <Empty />}
          </Section>

          <Section title={`Cancelled (${cancelled.length})`}>
            {cancelled.map((d) => (
              <DeliveryCard
                key={d.id}
                d={d}
                drivers={drivers}
                onOpen={() => router.push(`/admin/courier/${d.id}`)}
              />
            ))}
            {cancelled.length === 0 && <Empty />}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, background: "#fff", padding: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>{children}</div>
    </div>
  );
}

function Empty() {
  return <div style={{ padding: 14, color: "#6b7280", background: "#f9fafb", border: "1px dashed #e5e7eb", borderRadius: 12 }}>No items.</div>;
}

function DeliveryCard({
  d,
  drivers,
  onAssign,
  onUnassign,
  onOpen,
}: {
  d: Delivery;
  drivers: Driver[];
  onAssign?: (deliveryId: string, driverId: string) => void;
  onUnassign?: (deliveryId: string) => void;
  onOpen: () => void;
}) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>{d.id.slice(0, 8)}…</div>
        <div style={{ fontWeight: 900, color: d.status === "cancelled" ? "#b91c1c" : "#111827" }}>{d.status}</div>
      </div>

      <div style={{ marginTop: 10, fontSize: 13, color: "#374151", lineHeight: 1.4 }}>
        <div><strong>Pickup:</strong> {d.pickup_address || "—"}</div>
        <div><strong>Drop-off:</strong> {d.dropoff_address || "—"}</div>
        <div><strong>Recipient:</strong> {d.recipient_name || "—"} {d.recipient_phone ? `(${d.recipient_phone})` : ""}</div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button
          onClick={onOpen}
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 800 }}
        >
          Open
        </button>

        {onAssign && (
          <select
            defaultValue=""
            onChange={(e) => e.target.value && onAssign(d.id, e.target.value)}
            style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 800 }}
          >
            <option value="">Assign driver…</option>
            {drivers.map((dr) => (
              <option key={dr.id} value={dr.id}>
                {dr.email}
              </option>
            ))}
          </select>
        )}

        {onUnassign && (
          <button
            onClick={() => onUnassign(d.id)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #fecaca", background: "#fff", cursor: "pointer", fontWeight: 900, color: "#b91c1c" }}
          >
            Unassign
          </button>
        )}
      </div>
    </div>
  );
}