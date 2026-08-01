"use client";

import * as React from "react";
import Link from "next/link";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { fetchMyAssignment } from "./client";

/**
 * DRV-001 — the canonical current assignment.
 *
 * ADDITIVE on purpose. The dashboard below it still reads the legacy
 * `/api/driver/my-deliveries`, and this slice does not redesign the driver
 * screens; it adds the one thing managed dispatch produces. Replacing the
 * legacy section here would be a redesign, and would take Group J's coverage
 * of that endpoint with it.
 *
 * Styling matches the surrounding page's inline style rather than the canonical
 * primitives, for the same reason: consistency with what is actually on the
 * screen today beats a half-converted page.
 *
 * A failed read never renders as "no assignment" — not knowing and having none
 * are different facts, and the driver acts differently on each.
 */
export function DriverAssignmentCard() {
  const [assigned, setAssigned] = React.useState<any | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchMyAssignment();
      if (cancelled) return;
      setLoading(false);
      if (isApiFailure(r)) {
        setError(withReference(r));
        return;
      }
      setAssigned(r.value.assigned);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  return (
    <div style={card} data-testid="drv001-assignment">
      <h2 style={sectionTitle}>Couranr assignment</h2>

      {error ? (
        <p style={{ marginTop: 10, color: "#b91c1c" }} role="alert">
          Your assignment could not be loaded. {error}
        </p>
      ) : !assigned ? (
        <p style={{ marginTop: 10, color: "#555" }}>
          No delivery assigned to you. Couranr assigns work — there is nothing to accept or claim.
        </p>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 650 }}>
            Pickup {new Date(assigned.scheduledPickupStart).toLocaleString()} –{" "}
            {new Date(assigned.scheduledPickupEnd).toLocaleString()}
          </div>
          <div style={{ marginTop: 6, color: "#555" }}>
            {assigned.pickup?.line1}
            {assigned.pickup?.city ? `, ${assigned.pickup.city}` : ""} →{" "}
            {assigned.dropoff?.line1}
            {assigned.dropoff?.city ? `, ${assigned.dropoff.city}` : ""}
          </div>
          <div style={{ marginTop: 6, color: "#555" }}>
            {assigned.merchant?.name ? `From ${assigned.merchant.name}. ` : ""}
            Status: {String(assigned.fulfillmentState).replace(/_/g, " ")}.
          </div>
          <Link href={`/driver/deliveries/${assigned.deliveryId}`} style={button}>
            Open assigned delivery
          </Link>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 20,
  background: "#fff",
  marginTop: 24,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

const button: React.CSSProperties = {
  marginTop: 16,
  padding: "12px 18px",
  background: "#16a34a",
  color: "#fff",
  borderRadius: 10,
  fontWeight: 650,
  textDecoration: "none",
  display: "inline-block",
};
