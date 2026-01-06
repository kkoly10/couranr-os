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

  const price = sp.get("price") ?? "0";
  const miles = sp.get("miles") ?? "0";
  const pickup = sp.get("pickup") ?? "";
  const dropoff = sp.get("dropoff") ?? "";
  const weight = sp.get("weight") ?? "0";
  const rush = sp.get("rush") === "1";
  const signature = sp.get("signature") === "1";
  const stops = sp.get("stops") ?? "0";

  const amountCents = useMemo(
    () => Math.round(num(price) * 100),
    [price]
  );

  async function continueToPayment() {
    setErr(null);
    setLoading(true);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.push(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }

    const res = await fetch("/api/delivery/start-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pickupAddress: pickup,
        dropoffAddress: dropoff,
        miles: num(miles),
        weight: num(weight),
        stops: num(stops),
        rush,
        signature,
        totalCents: amountCents,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      setErr(json?.error || "Failed to continue to payment");
      setLoading(false);
      return;
    }

    window.location.href = json.url;
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>Confirm delivery details</h1>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
        <div><strong>Pickup:</strong> {pickup || "—"}</div>
        <div><strong>Drop-off:</strong> {dropoff || "—"}</div>
        <div><strong>Miles:</strong> {num(miles).toFixed(2)}</div>
        <div><strong>Weight:</strong> {num(weight)} lbs</div>
        <div><strong>Stops:</strong> {num(stops)}</div>
        <div><strong>Rush:</strong> {rush ? "Yes" : "No"}</div>
        <div><strong>Signature:</strong> {signature ? "Yes" : "No"}</div>
        <div style={{ marginTop: 12, fontSize: 18 }}>
          <strong>Total:</strong> ${num(price).toFixed(2)}
        </div>
      </div>

      {err && <p style={{ color: "red" }}>{err}</p>}

      <button
        onClick={continueToPayment}
        disabled={loading}
        style={{ marginTop: 20 }}
      >
        {loading ? "Working…" : "Continue to payment"}
      </button>
    </div>
  );
}