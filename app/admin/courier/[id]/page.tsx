"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Delivery = {
  id: string;
  status: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  delivery_notes?: string | null;
  driver_id?: string | null;
};

type Driver = { id: string; email: string };

export default function AdminCourierDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String((params as any)?.id || "");

  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authFetch(path: string, init?: RequestInit) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Unauthorized");

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
    if (!id) return;
    setError(null);
    try {
      const [d, dr] = await Promise.all([
        authFetch(`/api/admin/courier/deliveries/${id}`),
        authFetch(`/api/admin/drivers`),
      ]);
      setDelivery(d.delivery || null);
      setEvents(d.events || []);
      setDrivers((dr.drivers || []).map((x: any) => ({ id: x.id, email: x.email })));
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function patch(payload: Record<string, any>) {
    setBusy(true);
    try {
      await authFetch(`/api/admin/courier/deliveries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const reason = window.prompt("Cancel reason", "Cancelled by admin") || "Cancelled by admin";
    setBusy(true);
    try {
      await authFetch(`/api/admin/courier/deliveries/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  async function reinstate() {
    setBusy(true);
    try {
      await authFetch(`/api/admin/courier/deliveries/${id}/reinstate`, { method: "POST" });
      await load();
    } catch (e: any) {
      setError(e?.message || "Reinstate failed");
    } finally {
      setBusy(false);
    }
  }

  async function assignDriver(driverId: string) {
    setBusy(true);
    try {
      await authFetch(`/api/admin/courier/deliveries/${id}/assign-driver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function unassignDriver() {
    setBusy(true);
    try {
      await authFetch(`/api/admin/courier/deliveries/${id}/unassign-driver`, { method: "POST" });
      await load();
    } catch (e: any) {
      setError(e?.message || "Unassign failed");
    } finally {
      setBusy(false);
    }
  }

  if (!delivery) {
    return <div style={{ padding: 24 }}>{error || "Loading delivery…"}</div>;
  }

  return (
    <main className="page">
      <div className="cContainer" style={{ maxWidth: 980 }}>
        <div className="heroActions" style={{ marginBottom: 12 }}>
          <Link className="btn btnGhost" href="/admin/courier">← Back to courier admin</Link>
          <button className="btn btnGhost" onClick={load}>Refresh</button>
        </div>

        <div className="card">
          <h1 className="cardTitle" style={{ marginTop: 0 }}>Delivery {delivery.id.slice(0, 8)}…</h1>
          <p className="cardDesc">Status: <strong>{delivery.status}</strong></p>

          {error && <div className="statusNote statusError">{error}</div>}

          <div className="formGrid" style={{ marginTop: 10 }}>
            <div className="field"><label className="fieldLabel">Pickup address</label><input className="fieldInput" value={delivery.pickup_address || ""} readOnly /></div>
            <div className="field"><label className="fieldLabel">Drop-off address</label><input className="fieldInput" value={delivery.dropoff_address || ""} readOnly /></div>
            <div className="field"><label className="fieldLabel">Pickup address</label><input className="fieldInput" value={delivery.pickup_address || ""} onChange={(e)=>setDelivery({...delivery,pickup_address:e.target.value})} /></div>
            <div className="field"><label className="fieldLabel">Drop-off address</label><input className="fieldInput" value={delivery.dropoff_address || ""} onChange={(e)=>setDelivery({...delivery,dropoff_address:e.target.value})} /></div>
            <div className="field"><label className="fieldLabel">Recipient name</label><input className="fieldInput" value={delivery.recipient_name || ""} onChange={(e)=>setDelivery({...delivery,recipient_name:e.target.value})} /></div>
            <div className="field"><label className="fieldLabel">Recipient phone</label><input className="fieldInput" value={delivery.recipient_phone || ""} onChange={(e)=>setDelivery({...delivery,recipient_phone:e.target.value})} /></div>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label className="fieldLabel">Delivery notes</label>
            <textarea className="fieldInput" style={{ height: 100, paddingTop: 10 }} value={delivery.delivery_notes || ""} onChange={(e)=>setDelivery({...delivery,delivery_notes:e.target.value})} />
          </div>

          <div className="heroActions" style={{ marginTop: 12 }}>
            <button className="btn btnGold" disabled={busy} onClick={() => patch({
              pickup_address: delivery.pickup_address,
              dropoff_address: delivery.dropoff_address,
              recipient_name: delivery.recipient_name,
              recipient_phone: delivery.recipient_phone,
              delivery_notes: delivery.delivery_notes,
            })}>Save edits</button>

            {delivery.status !== "cancelled" ? (
              <button className="btn btnGhost" disabled={busy} onClick={cancel}>Cancel delivery</button>
            ) : (
              <button className="btn btnGhost" disabled={busy} onClick={reinstate}>Reinstate delivery</button>
            )}

            {delivery.driver_id ? (
              <button className="btn btnGhost" disabled={busy} onClick={unassignDriver}>Unassign driver</button>
            ) : (
              <select className="fieldInput" style={{ width: 280 }} onChange={(e) => e.target.value && assignDriver(e.target.value)} defaultValue="">
                <option value="">Assign driver…</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.email}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <h2 className="cardTitle" style={{ marginTop: 0 }}>Admin audit events</h2>
          {events.length === 0 ? <p className="cardDesc">No audit events yet.</p> : (
            <ul className="cardList">
              {events.map((e) => (
                <li key={e.id}>{e.event_type} — {new Date(e.created_at).toLocaleString()}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
