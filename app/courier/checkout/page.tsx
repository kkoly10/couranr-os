"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CheckoutInner() {
  const params = useSearchParams();

  const total = params.get("price");
  const miles = params.get("miles");
  const weight = params.get("weight");
  const stops = params.get("stops") ?? "0";
  const rush = params.get("rush") === "1";
  const signature = params.get("signature") === "1";

  async function continueToPayment() {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountCents: Math.round(Number(total) * 100),
      }),
    });

    const data = await res.json();

    if (!data.url) {
      alert("Unable to start payment");
      return;
    }

    window.location.href = data.url;
  }

  return (
    <div style={{ maxWidth: 600, margin: "40px auto" }}>
      <h1>Confirm delivery details</h1>

      <p>Miles: {miles}</p>
      <p>Weight: {weight} lbs</p>
      <p>Stops: {stops}</p>
      <p>Rush: {rush ? "Yes" : "No"}</p>
      <p>Signature: {signature ? "Yes" : "No"}</p>

      <h2>Total: ${total}</h2>

      <button
        onClick={continueToPayment}
        style={{
          marginTop: 20,
          padding: "14px 20px",
          background: "#000",
          color: "#fff",
          borderRadius: 8,
          fontWeight: 600,
        }}
      >
        Continue to payment
      </button>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<p>Loading checkout…</p>}>
      <CheckoutInner />
    </Suspense>
  );
}
