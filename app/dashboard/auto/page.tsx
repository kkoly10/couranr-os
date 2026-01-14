"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  purpose: string;
  lockbox_code_released_at: string | null;
  pickup_confirmed_at: string | null;
};

type PhotoPhase = {
  phase: string;
};

export default function AutoDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [photos, setPhotos] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.push("/login?next=/dashboard/auto");
      return;
    }

    // Load rentals
    const { data: rentalsData, error: rErr } = await supabase
      .from("rentals")
      .select(
        `
        id,
        purpose,
        lockbox_code_released_at,
        pickup_confirmed_at
      `
      )
      .order("created_at", { ascending: false });

    if (rErr) {
      setError(rErr.message);
      setLoading(false);
      return;
    }

    setRentals(rentalsData || []);

    // Load photos per rental
    const map: Record<string, Set<string>> = {};

    for (const r of rentalsData || []) {
      const { data: p } = await supabase
        .from("rental_condition_photos")
        .select("phase")
        .eq("rental_id", r.id);

      map[r.id] = new Set((p || []).map((x: PhotoPhase) => x.phase));
    }

    setPhotos(map);
    setLoading(false);
  }

  async function confirmPickup(rentalId: string) {
    setError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.push("/login");
      return;
    }

    const res = await fetch("/api/auto/confirm-pickup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ rentalId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Failed to confirm pickup");
      return;
    }

    await load();
  }

  if (loading) return <p style={{ padding: 24 }}>Loading auto dashboard…</p>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 32 }}>My Rentals</h1>
      <p style={{ color: "#555", marginTop: 6 }}>
        Follow each step carefully to pick up and return your vehicle.
      </p>

      {error && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fff",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      )}

      {rentals.length === 0 && (
        <p style={{ marginTop: 20 }}>You don’t have any rentals yet.</p>
      )}

      {rentals.map((r) => {
        const phases = photos[r.id] || new Set<string>();
        const hasPickupExterior = phases.has("pickup_exterior");
        const hasPickupInterior = phases.has("pickup_interior");

        const canConfirmPickup =
          !!r.lockbox_code_released_at &&
          !r.pickup_confirmed_at &&
          hasPickupExterior &&
          hasPickupInterior;

        return (
          <div
            key={r.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              marginTop: 16,
              background: "#fff",
            }}
          >
            <strong>Rental ID:</strong> {r.id}
            <br />
            <strong>Purpose:</strong>{" "}
            {r.purpose === "rideshare" ? "Rideshare" : "Personal"}
            <br />
            <strong>Lockbox released:</strong>{" "}
            {r.lockbox_code_released_at ? "Yes" : "No"}
            <br />
            <strong>Pickup confirmed:</strong>{" "}
            {r.pickup_confirmed_at ? "Yes" : "No"}
            <br />

            <div style={{ marginTop: 12 }}>
              <strong>Pickup photos:</strong>{" "}
              {hasPickupExterior ? "Exterior ✅" : "Exterior ❌"} •{" "}
              {hasPickupInterior ? "Interior ✅" : "Interior ❌"}
            </div>

            {canConfirmPickup && (
              <button
                onClick={() => confirmPickup(r.id)}
                style={{
                  marginTop: 14,
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "#111827",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Confirm Pickup
              </button>
            )}

            {!canConfirmPickup && !r.pickup_confirmed_at && (
              <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
                Complete all required steps before confirming pickup.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}