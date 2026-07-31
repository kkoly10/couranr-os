"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchMyDeliveries,
  isDriverLoadFailure,
  statusLabel,
  type DriverDelivery,
} from "@/lib/couranr/driver/deliveries";

/**
 * DRV-002 — my deliveries.
 *
 * This screen used to expect joined `pickup_address` / `dropoff_address`
 * OBJECTS and read `payload.deliveries`, while the endpoint returned `{ data }`
 * with no join at all. `data.deliveries` was therefore always `undefined`, the
 * `|| []` fallback swallowed it, and the screen showed "No assigned deliveries"
 * unconditionally. It also read `d.pickup_address.address_line` with no null
 * guard, which would have thrown the moment a payload did arrive.
 *
 * Both screens now consume one endpoint and one type. The client-side role
 * check and the /login and / redirects are gone: SurfaceGuard owns navigation,
 * the endpoint owns authorization.
 *
 * Styling is deliberately unchanged — this commit fixes the read, not the look.
 */
export default function DriverDeliveriesPage() {
  const [deliveries, setDeliveries] = useState<DriverDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; correlationId?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const r = await fetchMyDeliveries(signal);
    if (signal?.aborted) return;
    if (isDriverLoadFailure(r)) {
      // A failed load must not render as "no assigned deliveries" — that is the
      // exact confusion this screen shipped with.
      setDeliveries([]);
      setFailure({ message: r.message, correlationId: r.correlationId });
    } else {
      setDeliveries(r.deliveries);
      setFailure(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  /**
   * /api/delivery/mark-in-transit is a verified server command: it resolves the
   * actor from a Bearer token and requires them to be the assigned driver (or
   * Operations). This call must therefore forward the session access token.
   */
  async function startDelivery(deliveryId: string) {
    setStartingId(deliveryId);
    setActionError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token;
      if (!token) {
        // No redirect from here — SurfaceGuard handles an expired session on the
        // next check. Say what happened instead of bouncing to a legacy route.
        setActionError("Your session expired. Refresh the page and sign in again.");
        return;
      }

      const res = await fetch("/api/delivery/mark-in-transit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deliveryId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(
          typeof data?.error === "string" && data.error ? data.error : "Could not start this delivery."
        );
        return;
      }

      // Refetch in place rather than reloading the document.
      await load();
    } catch {
      setActionError("Could not start this delivery.");
    } finally {
      setStartingId(null);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading deliveries…</p>;

  return (
    <div style={{ padding: 24 }}>
      <h1>My Deliveries</h1>

      {failure && (
        <div
          role="alert"
          style={{
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <strong>We could not load your deliveries.</strong>
          <div style={{ marginTop: 6, color: "#555" }}>
            {failure.message}
            {failure.correlationId ? ` Reference ${failure.correlationId}.` : ""}
          </div>
          <button style={{ marginTop: 10 }} onClick={() => load()}>
            Try again
          </button>
        </div>
      )}

      {actionError && <p style={{ color: "#dc2626", marginBottom: 12 }}>{actionError}</p>}

      {!failure && deliveries.length === 0 && <p>No assigned deliveries.</p>}

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
          <p><strong>Status:</strong> {statusLabel(d.status)}</p>
          <p><strong>Recipient:</strong> {d.recipientName ?? "—"}</p>
          <p><strong>Pickup:</strong> {d.pickupAddress ?? "—"}</p>
          <p><strong>Dropoff:</strong> {d.dropoffAddress ?? "—"}</p>
          <p><strong>Miles:</strong> {d.estimatedMiles?.toFixed(2) ?? "—"}</p>
          <p><strong>Weight:</strong> {d.weightLb ? `${d.weightLb} lbs` : "—"}</p>

          {d.status === "assigned" && (
            <button disabled={startingId === d.id} onClick={() => startDelivery(d.id)}>
              {startingId === d.id ? "Starting…" : "Start Delivery"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
