"use client";

import { useCallback, useEffect, useState } from "react";
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
  estimated_miles?: number | null;
  weight_lbs?: number | null;
  rush?: boolean | null;
  signature_required?: boolean | null;
  stops?: number | null;
  scheduled_at?: string | null;
};

type Driver = { id: string; email: string };

const STATUS_OPTIONS = [
  "awaiting_payment",
  "pending",
  "assigned",
  "in_transit",
  "completed",
  "cancelled",
];

export default function AdminCourierDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String((params as any)?.id || "");

  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
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
    },
    []
  );

  const load = useCallback(async () => {
    if (!id) return;

    setError(null);

    try {
      const [d, dr] = await Promise.all([
        authFetch(`/api/admin/courier/deliveries/${id}`),
        authFetch(`/api/admin/drivers`),
      ]);

      setDelivery(d.delivery || null);
      setEvents(d.events || []);
      setDrivers(
        (dr.drivers || []).map((x: any) => ({
          id: x.id,
          email: x.email,
        }))
      );
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    }
  }, [authFetch, id]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(
    async (payload: Record<string, any>) => {
      setBusy(true);
      setError(null);

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
    },
    [authFetch, id, load]
  );

  const cancelDelivery = useCallback(async () => {
    const reason =
      window.prompt("Cancel reason", "Cancelled by admin") || "Cancelled by admin";

    setBusy(true);
    setError(null);

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
  }, [authFetch, id, load]);

  const reinstate = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      await authFetch(`/api/admin/courier/deliveries/${id}/reinstate`, {
        method: "POST",
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "Reinstate failed");
    } finally {
      setBusy(false);
    }
  }, [authFetch, id, load]);

  const assignDriver = useCallback(
    async (driverId: string) => {
      if (!driverId) return;

      setBusy(true);
      setError(null);

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
    },
    [authFetch, id, load]
  );

  const unassignDriver = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      await authFetch(`/api/admin/courier/deliveries/${id}/unassign-driver`, {
        method: "POST",
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "Unassign failed");
    } finally {
      setBusy(false);
    }
  }, [authFetch, id, load]);

  if (!delivery) {
    return <div style={{ padding: 24 }}>{error || "Loading delivery…"}</div>;
  }

  const assignedDriver = drivers.find((d) => d.id === delivery.driver_id) || null;

  return (
    <main className="page">
      <div className="cContainer" style={{ maxWidth: 980 }}>
        <div className="heroActions" style={{ marginBottom: 12 }}>
          <Link className="btn btnGhost" href="/admin/courier">
            ← Back to courier admin
          </Link>
          <button className="btn btnGhost" onClick={load} disabled={busy}>
            Refresh
          </button>
        </div>

        <div className="card">
          <h1 className="cardTitle" style={{ marginTop: 0 }}>
            Delivery {delivery.id.slice(0, 8)}…
          </h1>
          <p className="cardDesc">
            Status: <strong>{delivery.status}</strong>
          </p>

          {error && <div className="statusNote statusError">{error}</div>}

          <div className="formGrid" style={{ marginTop: 10 }}>
            <div className="field">
              <label className="fieldLabel">Pickup address</label>
              <input
                className="fieldInput"
                value={delivery.pickup_address || ""}
                readOnly
              />
            </div>

            <div className="field">
              <label className="fieldLabel">Drop-off address</label>
              <input
                className="fieldInput"
                value={delivery.dropoff_address || ""}
                readOnly
              />
            </div>

            <div className="field">
              <label className="fieldLabel">Recipient name</label>
              <input
                className="fieldInput"
                value={delivery.recipient_name || ""}
                onChange={(e) =>
                  setDelivery({ ...delivery, recipient_name: e.target.value })
                }
              />
            </div>

            <div className="field">
              <label className="fieldLabel">Recipient phone</label>
              <input
                className="fieldInput"
                value={delivery.recipient_phone || ""}
                onChange={(e) =>
                  setDelivery({ ...delivery, recipient_phone: e.target.value })
                }
              />
            </div>

            <div className="field">
              <label className="fieldLabel">Status</label>
              <select
                className="fieldInput"
                value={delivery.status || "pending"}
                onChange={(e) =>
                  setDelivery({ ...delivery, status: e.target.value })
                }
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="fieldLabel">Assigned driver</label>
              {delivery.driver_id ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    className="fieldInput"
                    value={assignedDriver?.email || delivery.driver_id}
                    readOnly
                  />
                  <button
                    className="btn btnGhost"
                    disabled={busy}
                    onClick={unassignDriver}
                    type="button"
                  >
                    Unassign
                  </button>
                </div>
              ) : (
                <select
                  className="fieldInput"
                  onChange={(e) => e.target.value && assignDriver(e.target.value)}
                  defaultValue=""
                  disabled={busy}
                >
                  <option value="">Assign driver…</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.email}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label className="fieldLabel">Delivery notes</label>
            <textarea
              className="fieldInput"
              style={{ height: 100, paddingTop: 10 }}
              value={delivery.delivery_notes || ""}
              onChange={(e) =>
                setDelivery({ ...delivery, delivery_notes: e.target.value })
              }
            />
          </div>

          <div className="cardList" style={{ marginTop: 14 }}>
            <div>
              <strong>Estimated miles:</strong> {delivery.estimated_miles ?? "—"}
            </div>
            <div>
              <strong>Weight:</strong> {delivery.weight_lbs ?? "—"} lbs
            </div>
            <div>
              <strong>Rush:</strong> {delivery.rush ? "Yes" : "No"}
            </div>
            <div>
              <strong>Signature required:</strong>{" "}
              {delivery.signature_required ? "Yes" : "No"}
            </div>
            <div>
              <strong>Stops:</strong> {delivery.stops ?? 0}
            </div>
            <div>
              <strong>Scheduled at:</strong>{" "}
              {delivery.scheduled_at
                ? new Date(delivery.scheduled_at).toLocaleString()
                : "—"}
            </div>
          </div>

          <div className="heroActions" style={{ marginTop: 12 }}>
            <button
              className="btn btnGold"
              disabled={busy}
              onClick={() =>
                patch({
                  recipient_name: delivery.recipient_name,
                  recipient_phone: delivery.recipient_phone,
                  delivery_notes: delivery.delivery_notes,
                  status: delivery.status,
                })
              }
            >
              Save edits
            </button>

            {delivery.status !== "cancelled" ? (
              <button
                className="btn btnGhost"
                disabled={busy}
                onClick={cancelDelivery}
              >
                Cancel delivery
              </button>
            ) : (
              <button className="btn btnGhost" disabled={busy} onClick={reinstate}>
                Reinstate delivery
              </button>
            )}
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <h2 className="cardTitle" style={{ marginTop: 0 }}>
            Admin audit events
          </h2>
          {events.length === 0 ? (
            <p className="cardDesc">No audit events yet.</p>
          ) : (
            <ul className="cardList">
              {events.map((e) => (
                <li key={e.id}>
                  {e.event_type} — {new Date(e.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}