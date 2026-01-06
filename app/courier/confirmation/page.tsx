"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function ConfirmationInner() {
  const params = useSearchParams();
  const orderNumber = params.get("orderNumber");

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>
        🎉 Order received
      </h1>

      <p style={{ marginTop: 12, fontSize: 16 }}>
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
        Order Number: {orderNumber ?? "—"}
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