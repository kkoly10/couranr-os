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

  // Quote params
  const price = sp.get("price") ?? "0";
  const miles = sp.get("miles") ?? "0";
  const pickup = sp.get("pickup") ?? "";
  const dropoff = sp.get("dropoff") ?? "";
  const weight = sp.get("weight") ?? "0";
  const rush = sp.get("rush") === "1";
  const signature = sp.get("signature") === "1";

  // NEW — recipient info
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");

  const amountCents = useMemo(
    () => Math.round(num(price) * 100),
    [price]
  );

  async function continueToPayment() {
    setErr(null);

    if (!recipientName.trim() || !recipientPhone.trim()) {
      setErr("Recipient name and phone are required.");
      return;
    }

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
        stops: 0,
        totalCents: amountCents,

        // ✅ REQUIRED FIELDS
        recipientName,
        recipientPhone,
        deliveryNotes: deliveryNotes || null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setErr(data?.error || "Failed to continue to payment");
      setLoading(false);
      return;
    }

    setLoading(false);
    window.location.href = data.url;
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>Confirm delivery details</h1>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
        <div><strong>Pickup:</strong> {pickup}</div>
        <div><strong>Drop-off:</strong> {dropoff}</div>
        <div><strong>Miles:</strong> {num(miles).toFixed(2)}</div>
        <div><strong>Weight:</strong> {num(weight)} lbs</div>
        <div><strong>Total:</strong> ${num(price).toFixed(2)}</div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Recipient information</h3>

        <label>Recipient name (required)</label>
        <input
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          style={{ width: "100%", marginBottom: 10 }}
        />

        <label>Recipient phone (required)</label>
        <input
          value={recipientPhone}
          onChange={(e) => setRecipientPhone(e.target.value)}
          style={{ width: "100%", marginBottom: 10 }}
        />

        <label>Delivery notes (optional)</label>
        <textarea
          value={deliveryNotes}
          onChange={(e) => setDeliveryNotes(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      {err && <p style={{ color: "#b91c1c", fontWeight: 700 }}>{err}</p>}

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