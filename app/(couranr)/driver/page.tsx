"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  activeDelivery as pickActive,
  completedToday as pickCompletedToday,
  fetchMyDeliveries,
  isDriverLoadFailure,
  statusLabel,
  type DriverDelivery,
} from "@/lib/couranr/driver/deliveries";

/**
 * DRV-001 — driver dashboard.
 *
 * Reads /api/driver/my-deliveries and nothing else. It used to query Supabase
 * directly from the browser for `deliveries.pickup_address` and
 * `deliveries.dropoff_address`, columns that do not exist — the real schema has
 * `pickup_address_id` / `dropoff_address_id` into `addresses`. The resulting
 * PostgREST message was rendered straight to the driver as
 * "Error: column deliveries.pickup_address does not exist".
 *
 * There is no client-side role check here any more. SurfaceGuard owns where a
 * person is sent; the endpoint owns what they may read. Duplicating the check
 * in the page bought nothing and added a second, weaker, place to get it wrong.
 *
 * Styling is deliberately unchanged — this commit fixes the read, not the look.
 */
export default function DriverDashboardPage() {
  const [deliveries, setDeliveries] = useState<DriverDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ message: string; correlationId?: string } | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const r = await fetchMyDeliveries(ac.signal);
      if (ac.signal.aborted) return;
      if (isDriverLoadFailure(r)) {
        // A failed load is NOT an empty assignment list, and must not render as
        // "no active delivery".
        setDeliveries([]);
        setFailure({ message: r.message, correlationId: r.correlationId });
      } else {
        setDeliveries(r.deliveries);
        setFailure(null);
      }
      setLoading(false);
    })();
    return () => ac.abort();
  }, []);

  const activeDelivery = pickActive(deliveries);
  const completedToday = pickCompletedToday(deliveries);

  /* --------------- UI STATES -------------- */

  if (loading) {
    return (
      <div>
        <h1 style={styles.h1}>Driver Dashboard</h1>
        <p style={styles.sub}>Loading your deliveries…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <h1 style={styles.h1}>Driver Dashboard</h1>
          <p style={styles.sub}>
            Focus on active deliveries and complete them safely.
          </p>
        </div>

        <div style={styles.driverBadge}>Driver</div>
      </div>

      {/* Sanitized load failure. The reference is a correlation id, never a
          database message. */}
      {failure && (
        <div style={{ marginTop: 24, ...styles.card, borderColor: "#fecaca" }} role="alert">
          <strong>We could not load your deliveries.</strong>
          <div style={{ marginTop: 6, color: "#555" }}>
            {failure.message}
            {failure.correlationId ? ` Reference ${failure.correlationId}.` : ""}
          </div>
        </div>
      )}

      {/* ACTIVE DELIVERY */}
      <div style={{ marginTop: 24, ...styles.card }}>
        <h2 style={styles.sectionTitle}>Active Delivery</h2>

        {!activeDelivery && !failure && (
          <p style={{ marginTop: 10, color: "#555" }}>
            No active delivery assigned right now.
          </p>
        )}

        {activeDelivery && (
          <div style={{ marginTop: 14, ...styles.inner }}>
            <Info label="Order #" value={activeDelivery.orderNumber ?? "—"} />
            <Info label="Status" value={statusLabel(activeDelivery.status)} />
            <Info label="Recipient" value={activeDelivery.recipientName ?? "—"} />
            <Info label="Pickup address" value={activeDelivery.pickupAddress ?? "—"} />
            <Info label="Drop-off address" value={activeDelivery.dropoffAddress ?? "—"} />
            <Info
              label="Estimated miles"
              value={activeDelivery.estimatedMiles?.toFixed(2) ?? "—"}
            />
            <Info
              label="Weight"
              value={activeDelivery.weightLb ? `${activeDelivery.weightLb} lbs` : "—"}
            />

            <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
              {activeDelivery.status === "assigned" && (
                <PrimaryButton href={`/driver/delivery/${activeDelivery.id}/pickup`}>
                  Upload pickup photo
                </PrimaryButton>
              )}

              {activeDelivery.status === "in_transit" && (
                <PrimaryButton href={`/driver/delivery/${activeDelivery.id}/dropoff`}>
                  Upload drop-off photo
                </PrimaryButton>
              )}
            </div>
          </div>
        )}
      </div>

      {/* COMPLETED TODAY */}
      <div style={{ marginTop: 24, ...styles.card }}>
        <h2 style={styles.sectionTitle}>Completed Today</h2>

        {!completedToday.length && (
          <p style={{ marginTop: 10, color: "#555" }}>
            No deliveries completed today yet.
          </p>
        )}

        {completedToday.length > 0 && (
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {completedToday.map((d) => (
              <div key={d.id} style={styles.row}>
                <div>
                  <strong>{d.orderNumber ?? "Order"}</strong>
                  <div style={{ fontSize: 13, color: "#555" }}>
                    {d.createdAt ? new Date(d.createdAt).toLocaleTimeString() : "—"}
                  </div>
                </div>

                <span style={styles.completedPill}>Completed</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SAFETY */}
      <div style={{ marginTop: 24, ...styles.card }}>
        <h2 style={styles.sectionTitle}>Safety reminders</h2>
        <ul style={{ marginTop: 10, color: "#555", lineHeight: 1.6 }}>
          <li>Always upload clear pickup and drop-off photos</li>
          <li>Do not leave items unattended unless marked “no signature”</li>
          <li>Contact support if a situation feels unsafe</li>
        </ul>
      </div>
    </div>
  );
}

/* ---------------- HELPERS ---------------- */

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>
        {label}
      </div>
      <div style={{ fontWeight: 650 }}>{value}</div>
    </div>
  );
}

function PrimaryButton({ href, children }: any) {
  return (
    <Link
      href={href}
      style={{
        padding: "12px 18px",
        background: "#16a34a",
        color: "#fff",
        borderRadius: 10,
        fontWeight: 650,
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {children}
    </Link>
  );
}

const styles: Record<string, any> = {
  h1: { margin: 0, fontSize: 34, letterSpacing: "-0.02em" },
  sub: { marginTop: 10, color: "#444" },
  driverBadge: {
    background: "#16a34a",
    color: "#fff",
    padding: "8px 14px",
    borderRadius: 999,
    fontWeight: 700,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 20,
    background: "#fff",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
  },
  inner: {
    border: "1px solid #eef2f7",
    borderRadius: 14,
    padding: 16,
    background: "#fbfdff",
  },
  row: {
    border: "1px solid #eef2f7",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
    display: "flex",
    justifyContent: "space-between",
  },
  completedPill: {
    background: "#dcfce7",
    color: "#166534",
    padding: "6px 12px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
};
