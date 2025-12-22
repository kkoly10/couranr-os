"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  const params = useSearchParams();

  const quotedPrice = useMemo(() => {
    const p = params.get("price");
    const n = p ? Number(p) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [params]);

  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [isBusiness, setIsBusiness] = useState(params.get("business") === "1");
  const [businessHours, setBusinessHours] = useState("");
  const [needsSignature, setNeedsSignature] = useState(
    params.get("signature") === "1"
  );

  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);
  const [dropoffPhoto, setDropoffPhoto] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);

  const amountCents =
    quotedPrice !== null ? Math.round(quotedPrice * 100) : null;

  const authorizePayment = async () => {
    setError(null);

    if (!stripe || !elements) {
      setError("Payment system not ready.");
      return;
    }

    if (!amountCents || !recipientName || !recipientPhone) {
      setError("Missing required information.");
      return;
    }

    if (isBusiness && !businessHours) {
      setError("Business delivery hours required.");
      return;
    }

    if (!pickupPhoto || !dropoffPhoto) {
      setError("Pickup and drop-off photos are required.");
      return;
    }

    setProcessing(true);

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
        setSuccess(true);
      } else {
        setError("Unexpected payment status.");
      }
    } catch (e: any) {
      setError(e?.message || "Authorization failed.");
    }

    setProcessing(false);
  };

  return (
    <main style={{ padding: "100px 20px" }}>
      <div className="container">
        <h1>Checkout</h1>

        <div className="card" style={{ maxWidth: 680 }}>
          <strong>Quote</strong>
          <p style={{ fontSize: 22, fontWeight: 700 }}>
            {quotedPrice ? `$${quotedPrice.toFixed(2)}` : "—"}
          </p>
          <p style={{ color: "var(--muted)", marginBottom: 24 }}>
            Card will be authorized now and captured after delivery.
          </p>

          <h3>Card Information</h3>
          <div
            style={{
              padding: 12,
              border: "1px solid var(--border)",
              borderRadius: 8,
              marginBottom: 20
            }}
          >
            <CardElement />
          </div>

          {error && <p style={{ color: "#dc2626" }}>{error}</p>}

          {!success ? (
            <button
              style={{ width: "100%" }}
              onClick={authorizePayment}
              disabled={processing}
            >
              {processing ? "Authorizing…" : "Authorize Payment"}
            </button>
          ) : (
            <div
              style={{
                padding: 16,
                background: "var(--surface-alt)",
                borderRadius: 8
              }}
            >
              <strong>Payment authorized</strong>
              <p style={{ color: "var(--muted)" }}>
                Your delivery is confirmed. Funds will be captured after
                completion.
              </p>
            </div>
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
