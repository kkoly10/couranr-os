"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AuthGuard from "../../../components/AuthGuard";
import StripeProvider from "../../../components/StripeProvider";
import {
  CardElement,
  useElements,
  useStripe
} from "@stripe/react-stripe-js";

function CheckoutInner() {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const params = useSearchParams();

  const quotedPrice = useMemo(() => {
    const p = params.get("price");
    const n = p ? Number(p) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [params]);

  const amountCents =
    quotedPrice !== null ? Math.round(quotedPrice * 100) : null;

  // STEP CONTROL
  const [step, setStep] = useState<1 | 2>(1);

  // Recipient
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [isBusiness, setIsBusiness] = useState(params.get("business") === "1");
  const [businessHours, setBusinessHours] = useState("");
  const needsSignature = params.get("signature") === "1";

  // Photos
  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);
  const [dropoffPhoto, setDropoffPhoto] = useState<File | null>(null);

  // Payment
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 validation
  const continueToPayment = () => {
    setError(null);

    if (!recipientName || !recipientPhone) {
      setError("Recipient name and phone are required.");
      return;
    }

    if (isBusiness && !businessHours) {
      setError("Business delivery hours are required.");
      return;
    }

    if (!pickupPhoto || !dropoffPhoto) {
      setError("Pickup and drop-off photos are required.");
      return;
    }

    setStep(2);
  };

  // Step 2 payment
  const authorizePayment = async () => {
    if (!stripe || !elements || !amountCents) {
      setError("Payment system not ready.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents,
          currency: "usd",
          metadata: {
            service: "courier",
            signature_required: needsSignature ? "yes" : "no"
          }
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to create payment authorization.");
        setProcessing(false);
        return;
      }

      const result = await stripe.confirmCardPayment(data.clientSecret, {
        payment_method: {
          card: elements.getElement(CardElement)!
        }
      });

      if (result.error) {
        setError(result.error.message || "Card authorization failed.");
        setProcessing(false);
        return;
      }

      if (result.paymentIntent?.status === "requires_capture") {
        router.push("/courier/confirmation");
        return;
      }

      setError("Unexpected payment status.");
    } catch (e: any) {
      setError(e?.message || "Authorization failed.");
    }

    setProcessing(false);
  };

  return (
    <main style={{ padding: "100px 20px" }}>
      <div className="container">
        <h1>Checkout</h1>

        <div className="card" style={{ maxWidth: 700 }}>
          <strong>Quote</strong>
          <p style={{ fontSize: 22, fontWeight: 700 }}>
            {quotedPrice ? `$${quotedPrice.toFixed(2)}` : "—"}
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

              <div style={{ marginBottom: 12 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={isBusiness}
                    onChange={() => setIsBusiness(!isBusiness)}
                  />{" "}
                  Business address
                </label>
              </div>

              {isBusiness && (
                <>
                  <label>Business Hours</label>
                  <input
                    value={businessHours}
                    onChange={(e) => setBusinessHours(e.target.value)}
                    style={{ width: "100%", marginBottom: 16 }}
                  />
                </>
              )}

              <h3>Required Photos</h3>

              <label>Pickup Photo</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setPickupPhoto(e.target.files?.[0] || null)
                }
                style={{ width: "100%", marginBottom: 16 }}
              />

              <label>Drop-off Photo</label>
              <input
                type="file"
                accept="image/*"
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
              <h3 style={{ marginTop: 24 }}>Card Information</h3>

              <div
                style={{
                  padding: 12,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  marginBottom: 16
                }}
              >
                <CardElement />
              </div>

              {error && <p style={{ color: "#dc2626" }}>{error}</p>}

              <button
                style={{ width: "100%" }}
                onClick={authorizePayment}
                disabled={processing}
              >
                {processing ? "Authorizing…" : "Authorize Payment"}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function CourierCheckoutPage() {
  return (
    <AuthGuard>
      <StripeProvider>
        <CheckoutInner />
      </StripeProvider>
    </AuthGuard>
  );
}