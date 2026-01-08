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

  // Read quote params
  const price = sp.get("price") ?? "0";
  const miles = sp.get("miles") ?? "0";
  const pickup = sp.get("pickup") ?? "";
  const dropoff = sp.get("dropoff") ?? "";
  const weight = sp.get("weight") ?? "0";
  const rush = sp.get("rush") === "1" || sp.get("rush") === "true";
  const signature = sp.get("signature") === "1" || sp.get("signature") === "true";
  const stops = sp.get("stops") ?? sp.get("extraStops") ?? "0";
  const scheduledAt = sp.get("scheduledAt");

  // Recipient fields (NEW)
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");

  const amountCents = useMemo(() => Math.round(num(price) * 100), [price]);

  function cleanPhone(p: string) {
    return p.replace(/[^\d+]/g, "").trim();
  }

  async function continueToPayment() {
    setErr(null);

    // Basic validation before doing anything
    const rn = recipientName.trim();
    const rp = cleanPhone(recipientPhone);

    if (!pickup || !dropoff) {
      setErr("Missing pickup or drop-off address. Please re-generate your quote.");
      return;
    }
    if (!rn) {
      setErr("Recipient name is required.");
      return;
    }
    if (!rp || rp.length < 10) {
      setErr("Recipient phone is required (enter a valid number).");
      return;
    }
    if (!amountCents || amountCents < 50) {
      setErr("Invalid amount. Please re-generate your quote.");
      return;
    }

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
        stops: Math.max(0, Math.floor(num(stops))),
        totalCents: amountCents, // server will still validate/compute as needed
        scheduledAt: scheduledAt ?? null,

        // ✅ NEW: recipient info
        recipientName: rn,
        recipientPhone: rp,
        deliveryNotes: deliveryNotes.trim() || null,
      }),
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // ignore JSON parse errors
    }

    if (!res.ok) {
      setErr(data?.error || "Failed to continue to payment");
      setLoading(false);
      return;
    }

    // We expect server to return Stripe Checkout URL
    if (data?.url) {
      window.location.href = data.url;
      return;
    }

    setErr("Failed to create checkout session.");
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Confirm delivery details</h1>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
        <div><strong>Pickup:</strong> {pickup || "—"}</div>
        <div><strong>Drop-off:</strong> {dropoff || "—"}</div>
        <div><strong>Miles:</strong> {num(miles).toFixed(2)}</div>
        <div><strong>Weight:</strong> {num(weight)} lbs</div>
        <div><strong>Stops:</strong> {Math.max(0, Math.floor(num(stops)))}</div>
        <div><strong>Rush:</strong> {rush ? "Yes" : "No"}</div>
        <div><strong>Signature:</strong> {signature ? "Required" : "No"}</div>

        <div style={{ marginTop: 12, fontSize: 18 }}>
          <strong>Total:</strong> ${num(price).toFixed(2)}
        </div>
      </div>

      {/* Recipient info (NEW) */}
      <div style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Recipient information</h2>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>
            RECIPIENT NAME (REQUIRED)
          </div>
          <input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="Full name"
            style={{
              width: "100%",
              marginTop: 8,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              outline: "none",
            }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>
            RECIPIENT PHONE (REQUIRED)
          </div>
          <input
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            placeholder="(555) 555-5555"
            style={{
              width: "100%",
              marginTop: 8,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              outline: "none",
            }}
          />
          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
            We use this only for delivery coordination (arrival, handoff, issues).
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>
            DELIVERY NOTES (OPTIONAL)
          </div>
          <textarea
            value={deliveryNotes}
            onChange={(e) => setDeliveryNotes(e.target.value)}
            placeholder="Gate code, lobby instructions, call on arrival, etc."
            rows={3}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              outline: "none",
              resize: "vertical",
            }}
          />
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>
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
          fontWeight: 800,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Working…" : "Continue to payment"}
      </button>

      <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
        After payment, you’ll upload a pickup photo on the confirmation page.
      </div>
    </div>
  );
}