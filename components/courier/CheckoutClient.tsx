"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function CheckoutClient() {
  const router = useRouter();
  const params = useSearchParams();

  const quotedPrice = Number(params.get("price") || 0);
  const miles = params.get("miles");
  const pickup = params.get("pickup") || "";
  const dropoff = params.get("dropoff") || "";
  const weight = params.get("weight") || "";
  const rush = params.get("rush") === "1";
  const signature = params.get("signature") === "1";

  const [step, setStep] = useState<1 | 2>(1);

  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");

  // Customer uploads pickup photo ONLY
  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);

  const continueToPayment = () => {
    setError(null);

    if (!recipientName || !recipientPhone) {
      setError("Recipient name and phone are required.");
      return;
    }

    if (!pickupPhoto) {
      setError("Pickup photo is required.");
      return;
    }

    setStep(2);
  };

  return (
    <main style={{ padding: "100px 20px" }}>
      <div className="container">
        <h1>Checkout</h1>

        <div className="card" style={{ maxWidth: 760 }}>
          <strong>Summary</strong>
          <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
            <div><b>Pickup:</b> {pickup || "—"}</div>
            <div><b>Drop-off:</b> {dropoff || "—"}</div>
            <div><b>Distance:</b> {miles ? `${miles} miles` : "—"}</div>
            <div><b>Weight:</b> {weight ? `${weight} lbs` : "—"}</div>
            <div><b>Rush:</b> {rush ? "Yes" : "No"}</div>
            <div><b>Signature:</b> {signature ? "Yes" : "No"}</div>
          </div>

          <div style={{ marginTop: 14, fontSize: 26, fontWeight: 800 }}>
            ${quotedPrice.toFixed(2)}
          </div>

          {step === 1 && (
            <>
              <h3 style={{ marginTop: 24 }}>Recipient Information</h3>

              <label>Recipient Full Name</label>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                style={{ width: "100%", marginBottom: 16 }}
              />

              <label>Recipient Phone Number</label>
              <input
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                style={{ width: "100%", marginBottom: 16 }}
              />

              <h3>Pickup Photo (Required)</h3>
              <p style={{ color: "var(--muted)", marginTop: 6 }}>
                Upload a pickup photo showing the item/package condition at handoff.
                The driver will upload the drop-off photo as proof of delivery.
              </p>

              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPickupPhoto(e.target.files?.[0] || null)}
                style={{ width: "100%", marginBottom: 16 }}
              />

              {error && <p style={{ color: "#dc2626" }}>{error}</p>}

              <button style={{ width: "100%" }} onClick={continueToPayment}>
                Continue to Payment
              </button>

              <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 12 }}>
                Safety note: Drivers may refuse pickup if an item appears unsafe, exceeds declared weight,
                or requires more than one person to lift. Support may contact you to adjust pricing or cancel the order.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <h3 style={{ marginTop: 24 }}>Payment</h3>
              <p style={{ color: "var(--muted)" }}>
                Card entry will be enabled next. Payment will be authorized now and captured after delivery.
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
  );
}
