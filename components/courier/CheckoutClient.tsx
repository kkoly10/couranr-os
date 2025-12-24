"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function CheckoutClient() {
  const params = useSearchParams();
  const quotedPrice = Number(params.get("price") || 0);
  const amountCents = Math.round(quotedPrice * 100);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents })
      });

      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Failed to start checkout");
      }

      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: "100px 20px" }}>
      <div className="container">
        <div className="card" style={{ maxWidth: 520 }}>
          <h1>Checkout</h1>

          <div style={{ fontSize: 26, fontWeight: 800 }}>
            ${quotedPrice.toFixed(2)}
          </div>

          <button
            style={{ width: "100%", marginTop: 24 }}
            onClick={startCheckout}
            disabled={loading}
          >
            {loading ? "Redirecting…" : "Proceed to Secure Payment"}
          </button>

          {error && (
            <p style={{ color: "#dc2626", marginTop: 12 }}>{error}</p>
          )}

          <p style={{ marginTop: 16, color: "#6b7280", fontSize: 13 }}>
            You’ll complete payment securely on Stripe and return here once authorized.
          </p>
        </div>
      </div>
    </main>
  );
}
