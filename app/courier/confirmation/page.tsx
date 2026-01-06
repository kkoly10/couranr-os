"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function CourierConfirmationPage() {
  const params = useSearchParams();
  const orderNumber = params.get("orderNumber");

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "60px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 44, marginBottom: 16 }}>✅</div>

      <h1 style={{ fontSize: 32, marginBottom: 12 }}>
        Order received
      </h1>

      <p style={{ fontSize: 16, color: "#444", lineHeight: 1.6 }}>
        Thank you for choosing <strong>Couranr Delivery</strong>.
        <br />
        Your delivery request has been successfully submitted.
      </p>

      {orderNumber && (
        <div
          style={{
            marginTop: 18,
            padding: 12,
            borderRadius: 10,
            background: "#f1f5f9",
            fontWeight: 700,
          }}
        >
          Order #{orderNumber}
        </div>
      )}

      <div
        style={{
          marginTop: 28,
          display: "flex",
          gap: 12,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/dashboard"
          style={{
            padding: "12px 18px",
            background: "#2563eb",
            color: "#fff",
            borderRadius: 10,
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          Go to dashboard
        </Link>

        <Link
          href="/courier"
          style={{
            padding: "12px 18px",
            border: "1px solid #d1d5db",
            color: "#111",
            borderRadius: 10,
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          New delivery
        </Link>
      </div>

      <div
        style={{
          marginTop: 32,
          fontSize: 13,
          color: "#6b7280",
        }}
      >
        You’ll receive updates as your delivery progresses.
      </div>
    </div>
  );
}
