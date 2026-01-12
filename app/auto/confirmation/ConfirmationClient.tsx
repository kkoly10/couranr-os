"use client";

import { useSearchParams, useRouter } from "next/navigation";

export default function ConfirmationClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const rentalId = sp.get("rentalId");
  const paid = sp.get("paid") === "1";

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 40 }}>
      <h1 style={{ fontSize: 32 }}>
        {paid ? "Payment Successful ✅" : "Checkout Incomplete"}
      </h1>

      {paid ? (
        <>
          <p style={{ marginTop: 12, color: "#374151", lineHeight: 1.6 }}>
            Your rental has been confirmed.
          </p>

          <div
            style={{
              marginTop: 20,
              padding: 18,
              borderRadius: 14,
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
            }}
          >
            <strong>Next steps</strong>
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              <li>Upload vehicle condition photos (required)</li>
              <li>Pickup at <strong>1090 Stafford Marketplace, VA 22556</strong></li>
              <li>Bring your valid driver’s license</li>
              <li>Be on time to avoid late fees</li>
            </ul>
          </div>

          <button
            onClick={() =>
              router.push(`/dashboard/rentals?rentalId=${encodeURIComponent(rentalId || "")}`)
            }
            style={{
              marginTop: 24,
              padding: "14px 18px",
              borderRadius: 12,
              border: "none",
              background: "#111827",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Go to my rentals
          </button>
        </>
      ) : (
        <>
          <p style={{ marginTop: 12, color: "#b91c1c" }}>
            Payment was not completed. Your reservation is not active.
          </p>

          <button
            onClick={() => router.back()}
            style={{
              marginTop: 24,
              padding: "14px 18px",
              borderRadius: 12,
              border: "none",
              background: "#111827",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Return
          </button>
        </>
      )}
    </div>
  );
}