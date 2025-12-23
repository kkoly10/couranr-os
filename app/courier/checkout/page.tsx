"use client";

/**
 * Force dynamic rendering.
 * This prevents static prerendering errors with useSearchParams.
 */
export const dynamic = "force-dynamic";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AuthGuard from "../../../components/AuthGuard";

export default function CourierCheckoutPage() {
  const router = useRouter();
  const params = useSearchParams();

  const quotedPrice = Number(params.get("price") || 0);

  const [step, setStep] = useState<1 | 2>(1);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);
  const [dropoffPhoto, setDropoffPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const continueToPayment = () => {
    setError(null);

    if (!recipientName || !recipientPhone) {
      setError("Recipient name and phone are required.");
      return;
    }

    if (!pickupPhoto || !dropoffPhoto) {
      setError("Pickup and drop-off photos are required.");
      return;
    }

    setStep(2);
  };

  return (
    <AuthGuard>
      <main style={{ padding: "100px 20px" }}>
        <div className="container">
          <h1>Checkout</h1>

          <div className="card" style={{ maxWidth: 700 }}>
            <strong>Quote</strong>
            <p style={{ fontSize: 22, fontWeight: 700 }}>
              ${quotedPrice.toFixed(2)}
            </p>

            {step === 1 && (
              <>
                <h3 style={{ marginTop: 24 }}>Recipient Information</h3>

                <label>Full Name</label>
                <input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  style={{ width: "100%", marginBottom: 16 }}
                />

                <label>Phone Number</label>
                <input
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  style={{ width: "100%", marginBottom: 16 }}
                />

                <h3>Required Photos</h3>

                <label>Pickup Photo</label>
                <input
                  type="file"
                  onChange={(e) =>
                    setPickupPhoto(e.target.files?.[0] || null)
                  }
                  style={{ width: "100%", marginBottom: 16 }}
                />

                <label>Drop-off Photo</label>
                <input
                  type="file"
                  onChange={(e) =>
                    setDropoffPhoto(e.target.files?.[0] || null)
                  }
                  style={{ width: "100%", marginBottom: 24 }}
                />

                {error && <p style={{ color: "#dc2626" }}>{error}</p>}

                <button style={{ width: "100%" }} onClick={continueToPayment}>
                  Continue to Payment
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <h3 style={{ marginTop: 24 }}>Payment</h3>
                <p style={{ color: "var(--muted)" }}>
                  Card entry will appear here next.
                </p>

                <button
                  style={{ width: "100%", marginTop: 16 }}
                  onClick={() => router.push("/courier/confirmation")}
                >
                  Simulate Successful Payment
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}
