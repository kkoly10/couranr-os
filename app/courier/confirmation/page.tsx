"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function ConfirmationInner() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");

  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    fetch(`/api/orders/by-session?session_id=${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setOrderNumber(data.orderNumber);
        }
      })
      .catch(() => setError("Failed to load order details"));
  }, [sessionId]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>
        🎉 Order received
      </h1>

      <p style={{ marginTop: 12 }}>
        Thank you for your order. Your delivery has been successfully placed.
      </p>

      <div
        style={{
          marginTop: 20,
          padding: 16,
          borderRadius: 12,
          background: "#f3f4f6",
          fontWeight: 700,
        }}
      >
        {error
          ? error
          : orderNumber
          ? `Order Number: ${orderNumber}`
          : "Loading order number…"}
      </div>

      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <Link href="/dashboard/customer" style={btnPrimary}>
          Go to Dashboard
        </Link>
        <Link href="/courier" style={btnGhost}>
          New Delivery
        </Link>
      </div>
    </div>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense fallback={<p>Loading confirmation…</p>}>
      <ConfirmationInner />
    </Suspense>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "12px 16px",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  fontWeight: 800,
  textDecoration: "none",
};

const btnGhost: React.CSSProperties = {
  padding: "12px 16px",
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  borderRadius: 10,
  fontWeight: 800,
  textDecoration: "none",
};