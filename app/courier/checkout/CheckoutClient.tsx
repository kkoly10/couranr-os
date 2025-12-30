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

  // Read quote params
  const price = sp.get("price") ?? "0";
  const miles = sp.get("miles") ?? "0";
  const pickup = sp.get("pickup") ?? "";
  const dropoff = sp.get("dropoff") ?? "";
  const weight = sp.get("weight") ?? "0";
  const rush = sp.get("rush") === "1" || sp.get("rush") === "true";
  const signature = sp.get("signature") === "1" || sp.get("signature") === "true";
  const stops = sp.get("stops") ?? "0";
  const scheduledAt = sp.get("scheduledAt");

  const amountCents = useMemo(
    () => Math.round(num(price) * 100),
    [price]
  );

  async function continueToPayment() {
    setErr(null);
    setLoading(true);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;

    if (!token) {
      setLoading(false);
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    const res = await fetch("/api/delivery/start-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pickupAddress: { address_line: pickup },
        dropoffAddress: { address_line: dropoff },
        estimatedMiles: num(miles),
        weightLbs: num(weight),
        rush,
        signatureRequired: signature,
        stops: num(stops),
        totalCents: amountCents,
        scheduledAt: scheduledAt ?? null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setErr(data?.error || "Failed to continue to payment");
      setLoading(false);
      return;
    }

    const qs = new URLSearchParams({
      orderId: data.orderId,
      amountCents: String(data.amountCents),
      clientSecret: data.clientSecret,
      orderNumber: data.orderNumber,
    });

    setLoading(false);
    router.push(`/courier/checkout/payment?${qs.toString()}`);
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>
        Confirm delivery details
      </h1>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
        <div><strong>Pickup:</strong> {pickup || "—"}</div>
        <div><strong>Drop-off:</strong> {dropoff || "—"}</div>
        <div><strong>Miles:</strong> {num(miles).toFixed(2)}</div>
        <div><strong>Weight:</strong> {num(weight)} lbs</div>
        <div><strong>Stops:</strong> {num(stops)}</div>
        <div><strong>Rush:</strong> {rush ? "Yes" : "No"}</div>
        <div><strong>Signature:</strong> {signature ? "Required" : "No"}</div>

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