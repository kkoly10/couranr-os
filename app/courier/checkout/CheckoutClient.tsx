// app/courier/checkout/CheckoutClient.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function num(v: string | null, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function CheckoutClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Read quote params (display only — server is source of truth)
  const miles = sp.get("miles") ?? "0";
  const pickup = sp.get("pickup") ?? "";
  const dropoff = sp.get("dropoff") ?? "";
  const weight = sp.get("weight") ?? "0";
  const rush = sp.get("rush") === "1" || sp.get("rush") === "true";
  const signature = sp.get("signature") === "1" || sp.get("signature") === "true";

  // Support both naming styles: stops vs extraStops (you had both in different places)
  const stopsRaw = sp.get("stops") ?? sp.get("extraStops") ?? "0";
  const scheduledAt = sp.get("scheduledAt") ?? null;

  // Price shown on page (purely UI)
  const displayedPrice = useMemo(() => {
    const p = sp.get("price");
    return p ? num(p, 0) : 0;
  }, [sp]);

  async function continueToPayment() {
    setErr(null);
    setLoading(true);

    // ✅ Auth gate
    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;

    if (!token) {
      setLoading(false);
      const next = window.location.pathname + window.location.search;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    // ✅ Start checkout (server computes amount, creates order, creates Stripe session)
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
        stops: Math.max(0, Math.floor(num(stopsRaw))),
        scheduledAt,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setErr(data?.error || "Failed to start checkout");
      setLoading(false);
      return;
    }

    if (!data?.url) {
      setErr("Failed to create checkout session");
      setLoading(false);
      return;
    }

    // ✅ Redirect to Stripe checkout
    window.location.href = data.url;
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Confirm delivery details</h1>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
        <div><strong>Pickup:</strong> {pickup || "—"}</div>
        <div><strong>Drop-off:</strong> {dropoff || "—"}</div>
        <div><strong>Miles:</strong> {num(miles).toFixed(2)}</div>
        <div><strong>Weight:</strong> {num(weight)} lbs</div>
        <div><strong>Stops:</strong> {Math.max(0, Math.floor(num(stopsRaw)))}</div>
        <div><strong>Rush:</strong> {rush ? "Yes" : "No"}</div>
        <div><strong>Signature:</strong> {signature ? "Required" : "No"}</div>

        <div style={{ marginTop: 12, fontSize: 18 }}>
          <strong>Total:</strong>{" "}
          {displayedPrice > 0 ? `$${displayedPrice.toFixed(2)}` : "—"}
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            Final amount is calculated on the server at checkout.
          </div>
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