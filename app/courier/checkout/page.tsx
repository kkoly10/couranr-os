"use client";

export const dynamic = "force-dynamic";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CourierCheckoutPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceedToPayment() {
    try {
      setLoading(true);
      setError(null);

      // NOTE: These values should already exist in your state
      // Replace with your actual checkout state variables if named differently
      const payload = {
        pickupAddress: JSON.parse(
          decodeURIComponent(
            new URLSearchParams(window.location.search).get("pickup") || "{}"
          )
        ),
        dropoffAddress: JSON.parse(
          decodeURIComponent(
            new URLSearchParams(window.location.search).get("dropoff") || "{}"
          )
        ),
        estimatedMiles: Number(
          new URLSearchParams(window.location.search).get("miles") || 0
        ),
        weightLbs: Number(
          new URLSearchParams(window.location.search).get("weight") || 0
        ),
        rush:
          new URLSearchParams(window.location.search).get("rush") === "1",
        signatureRequired:
          new URLSearchParams(window.location.search).get("signature") === "1",
        stops: Number(
          new URLSearchParams(window.location.search).get("stops") || 0
        ),
        totalCents: Math.round(
          Number(
            new URLSearchParams(window.location.search).get("price") || 0
          ) * 100
        ),
      };

      const res = await fetch("/api/delivery/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create order");
      }

      const { orderId } = data;

      router.push(
        `/courier/checkout/payment?orderId=${orderId}&price=${
          payload.totalCents / 100
        }`
      );
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28 }}>Confirm delivery details</h1>

      <p style={{ marginTop: 12, color: "#555" }}>
        Review your delivery details before continuing to payment.
      </p>

      {error && (
        <div style={{ color: "red", marginTop: 12 }}>{error}</div>
      )}

      <button
        onClick={proceedToPayment}
        disabled={loading}
        style={{
          marginTop: 24,
          padding: "14px 20px",
          fontWeight: 700,
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          width: "100%",
          cursor: "pointer",
        }}
      >
        {loading ? "Creating order…" : "Continue to payment"}
      </button>
    </div>
  );
}
