"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function CheckoutClient() {
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
              <h3>Recipient Information</h3>

              <label>Full Name</label>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
              />

              <label>Phone Number</label>
              <input
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
              />

              <label>Pickup Photo</label>
              <input
                type="file"
                onChange={(e) =>
                  setPickupPhoto(e.target.files?.[0] || null)
                }
              />

              <label>Drop-off Photo</label>
              <input
                type="file"
                onChange={(e) =>
                  setDropoffPhoto(e.target.files?.[0] || null)
                }
              />

              {error && <p style={{ color: "red" }}>{error}</p>}

              <button onClick={continueToPayment}>
                Continue to Payment
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Payment</h3>
              <p>Card entry will appear here next.</p>

              <button onClick={() => router.push("/courier/confirmation")}>
                Simulate Successful Payment
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
