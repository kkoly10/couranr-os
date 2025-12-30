"use client";

import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useState } from "react";

export default function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/courier/checkout/success`,
      },
    });

    if (error) {
      setError(error.message || "Payment failed");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />

      {error && (
        <div style={{ color: "red", marginTop: 12 }}>{error}</div>
      )}

      <button
        type="submit"
        disabled={!stripe || loading}
        style={{
          marginTop: 20,
          width: "100%",
          padding: "12px",
          fontWeight: 700,
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        {loading ? "Authorizing…" : "Authorize payment"}
      </button>
    </form>
  );
}