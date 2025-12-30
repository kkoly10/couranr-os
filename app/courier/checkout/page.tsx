export const dynamic = "force-dynamic";

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CourierCheckoutPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function proceedToPayment() {
    setLoading(true);
    router.push("/courier/checkout/payment" + window.location.search);
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28 }}>Confirm delivery details</h1>

      <p style={{ marginTop: 12, color: "#555" }}>
        Please review your delivery information before continuing to payment.
      </p>

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
        {loading ? "Continuing…" : "Continue to payment"}
      </button>
    </div>
  );
}
