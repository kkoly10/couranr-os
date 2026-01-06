"use client";

import Link from "next/link";

export default function ConfirmationPage() {
  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 32, marginBottom: 12 }}>
        Payment received ✅
      </h1>

      <p style={{ fontSize: 16, color: "#444" }}>
        Your delivery order has been placed successfully.
      </p>

      <div style={{ marginTop: 24 }}>
        <Link
          href="/dashboard"
          style={{
            padding: "12px 16px",
            background: "#111827",
            color: "#fff",
            borderRadius: 10,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
