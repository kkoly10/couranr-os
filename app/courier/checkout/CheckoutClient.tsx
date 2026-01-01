"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

function num(v: string | null, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function CheckoutClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const price = sp.get("price") ?? "0";
  const miles = sp.get("miles") ?? "0";
  const pickup = sp.get("pickup") ?? "";
  const dropoff = sp.get("dropoff") ?? "";
  const weight = sp.get("weight") ?? "0";
  const rush = sp.get("rush") === "1" || sp.get("rush") === "true";
  const signature =
    sp.get("signature") === "1" || sp.get("signature") === "true";
  const stops = sp.get("stops") ?? "0";
  const scheduledAt = sp.get("scheduledAt"); // optional

  const amountCents = useMemo(() => Math.round(num(price) * 100), [price]);

  async function continueToPayment() {
    setErr(null);
    setLoading(true);

    // ✅ Auth gate (quote is public, order is not)
    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;

    if (!token) {
      setLoading(false);
      router.push(
        `/login?next=${encodeURIComponent(
          window.location.pathname + window.location.search
        )}`
      );
      return;
    }

    // ✅ Must have valid amount BEFORE calling backend
    if (!amountCents || amountCents < 50) {
      setErr("Invalid amount. Please re-generate your quote.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/delivery/start-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pickupAddress: {
          address_line: pickup,
          city: "",
          state: "",
          zip: "",
          is_business: false,
        },
        dropoffAddress: {
          address_line: dropoff,
          city: "",
          state: "",
          zip: "",
          is_business: false,
        },
        estimatedMiles: num(miles),
        weightLbs: num(weight),
        rush,
        signatureRequired: signature,
        stops: num(stops),
        scheduledAt: scheduledAt ?? null,
        totalCents: amountCents,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setErr(data?.error || "Unable to start checkout");
      setLoading(false);
      return;
    }

    if (!data?.url) {
      setErr("Stripe checkout URL missing. Please try again.");
      setLoading(false);
      return;
    }

    // ✅ Redirect to Stripe Checkout
    window.location.href = data.url;
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Confirm delivery details</h1>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div>
          <strong>Pickup:</strong> {pickup || "—"}
        </div>
        <div>
          <strong>Drop-off:</strong> {dropoff || "—"}
        </div>
        <div>
          <strong>Miles:</strong> {num(miles).toFixed(2)}
        </div>
        <div>
          <strong>Weight:</strong> {num(weight)} lbs
        </div>
        <div>
          <strong>Stops:</strong> {num(stops)}
        </div>
        <div>
          <strong>Rush:</strong> {rush ? "Yes" : "No"}
        </div>
        <div>
          <strong>Signature:</strong> {signature ? "Required" : "No"}
        </div>

        <div style={{ marginTop: 12, fontSize: 18 }}>
          <strong>Total:</strong> ${num(price).toFixed(2)}
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 600 }}>
          {err}
        </div>
      )}

      <button
        onClick={continueToPayment}
        disabled={loading}
        style={{
          marginTop: 18,
          padding: "12px 16px",
          borderRadius: 10,
          border: "none",
          background: "#111827",
          color: "#fff",
          fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Working…" : "Continue to payment"}
      </button>
    </div>
  );
}