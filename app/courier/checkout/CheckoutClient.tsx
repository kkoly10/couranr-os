"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function CheckoutClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = sp.get("price");
  const miles = sp.get("miles");

  useEffect(() => {
    if (!price || !miles) {
      setError("Missing checkout data.");
    }
  }, [price, miles]);

  function handleContinue() {
    if (!price) {
      setError("Invalid price.");
      return;
    }

    setLoading(true);

    const params = new URLSearchParams(sp.toString());
    router.push(`/courier/checkout/payment?${params.toString()}`);
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <h1>Checkout error</h1>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 28, marginBottom: 16 }}>
        Review & Confirm
      </h1>

      <p style={{ marginBottom: 24 }}>
        Total authorized amount: <strong>${price}</strong>
      </p>

      <button
        onClick={handleContinue}
        disabled={loading}
        style={{
          width: "100%",
          padding: "14px",
          fontSize: "16px",
          fontWeight: 700,
          background: "#2563eb",
          color: "#fff",
          borderRadius: 8,
          border: "none",
          cursor: "pointer",
        }}
      >
        {loading ? "Continuing…" : "Continue to payment"}
      </button>
    </div>
  );
}