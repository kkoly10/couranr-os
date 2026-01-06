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
  const params = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ✅ Read params
  const miles = num(params.get("miles"));
  const weightLbs = num(params.get("weight"));
  const stops = num(params.get("stops"));
  const rush = params.get("rush") === "1";
  const signature = params.get("signature") === "1";
  const price = num(params.get("price"));

  const pickup = params.get("pickup") ?? "";
  const dropoff = params.get("dropoff") ?? "";

  const amountCents = useMemo(
    () => Math.round(price * 100),
    [price]
  );

  async function continueToPayment() {
    setErr(null);
    setLoading(true);

    // 🔐 Auth gate
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    // 🚚 Start checkout
    const res = await fetch("/api/delivery/start-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        miles,              // ✅ FIXED
        weightLbs,          // ✅ FIXED
        stops,
        rush,
        signature,
        pickupAddress: pickup,
        dropoffAddress: dropoff,
      }),
    });

    const dataRes = await res.json();

    if (!res.ok) {
      setErr(dataRes?.error || "Failed to continue to payment");
      setLoading(false);
      return;
    }

    window.location.href = dataRes.url;
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>Confirm delivery details</h1>

      <p>Pickup: {pickup}</p>
      <p>Drop-off: {dropoff}</p>
      <p>Miles: {miles.toFixed(2)}</p>
      <p>Weight: {weightLbs} lbs</p>
      <p>Stops: {stops}</p>
      <p>Rush: {rush ? "Yes" : "No"}</p>
      <p>Signature: {signature ? "Yes" : "No"}</p>

      <h2>Total: ${price.toFixed(2)}</h2>

      {err && <p style={{ color: "red" }}>{err}</p>}

      <button
        onClick={continueToPayment}
        disabled={loading}
        style={{
          marginTop: 16,
          padding: "12px 16px",
          borderRadius: 10,
          background: "#111827",
          color: "#fff",
          fontWeight: 700,
        }}
      >
        {loading ? "Working…" : "Continue to payment"}
      </button>
    </div>
  );
}