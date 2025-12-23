"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

export default function CheckoutClient() {
  const router = useRouter();
  const params = useSearchParams();

  const stripe = useStripe();
  const elements = useElements();

  const quotedPrice = Number(params.get("price") || 0);
  const amountCents = Math.round(quotedPrice * 100);

  const [step, setStep] = useState<1 | 2>(1);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueToPayment = async () => {
    setError(null);

    if (!recipientName || !recipientPhone) {
      setError("Recipient name and phone are required.");
      return;
    }

    if (!pickupPhoto) {
      setError("Pickup photo is required.");
      return;
    }

    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Payment init failed");

      setClientSecret(data.clientSecret);
      setStep(2);
    } catch (e: any) {
      setError(e.message || "Failed to start payment");
    }
  };

  const authorizePayment = async () => {
    if (!stripe || !elements || !clientSecret) return;

    setProcessing(true);
    setError(null);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        payment_method_data: {
          billing_details: {
            name: recipientName,
            phone: recipientPhone
          }
        }
      },
      redirect: "if_required"
    });

    if (result.error) {
      setError(result.error.message || "Payment failed");
      setProcessing(false);
      return;
    }

    // Authorized successfully (manual capture later)
    router.push("/courier/confirmation");
  };

  return (
    <main style={{ padding: "100px 20px" }}>
      <div className="container">
        <h1>Checkout</h1>

        <div className="card" style={{ maxWidth: 760 }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>
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
            </>
          )}

          {step === 2 && clientSecret && (
            <>
              <h3 style={{ marginTop: 24 }}>Payment</h3>

              <div
                style={{
                  padding: 12,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  marginBottom: 16
                }}
              >
                <PaymentElement />
              </div>

              {error && <p style={{ color: "#dc2626" }}>{error}</p>}

              <button
                style={{ width: "100%" }}
                disabled={processing || !stripe}
                onClick={authorizePayment}
              >
                {processing ? "Authorizing…" : "Authorize Payment"}
              </button>

              <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 12 }}>
                Your card will be authorized now and charged after delivery is completed.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
