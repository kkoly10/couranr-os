"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string
);

function PaymentForm({
  clientSecret,
  onSuccess
}: {
  clientSecret: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {},
      redirect: "if_required"
    });

    if (result.error) {
      setError(result.error.message || "Payment failed");
      setLoading(false);
      return;
    }

    onSuccess();
  };

  return (
    <div
      style={{
        background: "#ffffff",
        padding: 24,
        borderRadius: 12,
        maxWidth: 520,
        margin: "100px auto",
        border: "1px solid #e5e7eb"
      }}
    >
      <h2>Payment</h2>

      <div
        style={{
          marginTop: 16,
          marginBottom: 16,
          padding: 12,
          border: "1px solid #d1d5db",
          borderRadius: 8
        }}
      >
        <PaymentElement />
      </div>

      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      <button
        onClick={submit}
        disabled={loading}
        style={{
          width: "100%",
          padding: 14,
          background: "#111827",
          color: "#ffffff",
          borderRadius: 8,
          border: "none",
          cursor: "pointer"
        }}
      >
        {loading ? "Authorizing…" : "Authorize Payment"}
      </button>
    </div>
  );
}

export default function CheckoutClient() {
  const router = useRouter();
  const params = useSearchParams();

  const price = Number(params.get("price") || 0);
  const amountCents = Math.round(price * 100);

  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const startPayment = async () => {
    const res = await fetch("/api/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents })
    });

    const data = await res.json();
    setClientSecret(data.clientSecret);
  };

  if (!clientSecret) {
    return (
      <div style={{ padding: 100, textAlign: "center" }}>
        <h2>${price.toFixed(2)}</h2>
        <button onClick={startPayment}>Proceed to Payment</button>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: "stripe" }
      }}
    >
      <PaymentForm
        clientSecret={clientSecret}
        onSuccess={() => router.push("/courier/confirmation")}
      />
    </Elements>
  );
}
