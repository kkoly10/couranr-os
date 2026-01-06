"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ConfirmationClient() {
  const params = useSearchParams();
  const router = useRouter();

  const sessionId = params.get("session_id");

  const [loading, setLoading] = useState(true);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError("Missing payment session.");
      setLoading(false);
      return;
    }

    async function loadOrder() {
      try {
        const res = await fetch(
          `/api/delivery/confirm?session_id=${sessionId}`
        );

        if (!res.ok) {
          throw new Error("Failed to load order");
        }

        const data = await res.json();
        setOrderNumber(data.orderNumber);
      } catch (err: any) {
        setError(err.message || "Unable to load order");
      } finally {
        setLoading(false);
      }
    }

    loadOrder();
  }, [sessionId]);

  if (loading) {
    return <p>Loading order number…</p>;
  }

  if (error) {
    return (
      <div style={{ maxWidth: 700, margin: "40px auto" }}>
        <h1>Payment received</h1>
        <p>{error}</p>
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            marginTop: 16,
            padding: "10px 14px",
            borderRadius: 8,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 700,
          }}
        >
          Go to dashboard
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: "40px auto" }}>
      <h1>Thank you for your order 🎉</h1>

      <p style={{ fontSize: 18, marginTop: 12 }}>
        Your order number is:
      </p>

      <div
        style={{
          marginTop: 10,
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          fontSize: 22,
          fontWeight: 800,
        }}
      >
        {orderNumber}
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Go to my dashboard
        </button>
      </div>
    </div>
  );
}