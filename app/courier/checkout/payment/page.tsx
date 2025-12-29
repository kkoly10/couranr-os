"use client";

import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_SHARABLE_KEY!
);

export default function CourierPaymentPage() {
  const sp = useSearchParams();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const price = Number(sp.get("price") ?? "0");

  useEffect(() => {
    async function createIntent() {
      try {
        const res = await fetch("/api/delivery/authorize-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountCents: Math.round(price * 100),
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Payment authorization failed");
        }

        setClientSecret(data.clientSecret);
      } catch (err: any) {
        setError(err.message);
      }
    }

    if (price > 0) {
      createIntent();
    }
  }, [price]);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Payment error</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Preparing secure payment…</h1>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 10 }}>
        Payment Authorization
      </h1>

      <p style={{ color: "#555", marginBottom: 20 }}>
        Your card will be authorized for <strong>${price.toFixed(2)}</strong>.
        You will only be charged after delivery is completed.
      </p>

      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: "stripe",
          },
        }}
      >
        <CheckoutForm />
      </Elements>
    </div>
  );
}