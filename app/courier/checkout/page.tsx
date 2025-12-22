"use client";

import { useMemo, useState } from "react";

import { useSearchParams } from "next/navigation";

import AuthGuard from "../../../components/AuthGuard";

export default function CourierCheckoutPage() {

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

  const [creatingAuth, setCreatingAuth] = useState(false);

  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);

  const amountCents = useMemo(() => {

    if (quotedPrice === null) return null;

    return Math.round(quotedPrice * 100);

  }, [quotedPrice]);

  const createAuthorization = async () => {

    setError(null);

    if (quotedPrice === null || amountCents === null) {

      setError("Missing quote price. Please return to the quote page.");

      return;

    }

    if (!recipientName || !recipientPhone) {

      setError("Recipient name and phone number are required.");

      return;

    }

    if (isBusiness && !businessHours) {

      setError("Please provide delivery hours for the business address.");

      return;

    }

    if (!pickupPhoto || !dropoffPhoto) {

      setError("Pickup and drop-off photos are required.");

      return;

    }

    setCreatingAuth(true);

    try {

      const res = await fetch("/api/create-payment-intent", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          amountCents,

          currency: "usd",

          metadata: {

            service: "courier",

            signature_required: needsSignature ? "yes" : "no",

            address_type: isBusiness ? "business" : "residential"

          }

        })

      });

      const data = await res.json();

      if (!res.ok) {

        setError(data?.error || "Failed to create authorization.");

        setCreatingAuth(false);

        return;

      }

      // Next step: we’ll use clientSecret with Stripe Elements to actually authorize the card.

      setPaymentIntentId(data.paymentIntentId);

      setCreatingAuth(false);

    } catch (e: any) {

      setError(e?.message || "Failed to create authorization.");

      setCreatingAuth(false);

    }

  };

  return (
<AuthGuard>
<main style={{ padding: "100px 20px" }}>
<div className="container">
<h1>Checkout</h1>
<p style={{ color: "var(--muted)", marginBottom: 24 }}>

            Recipient info + required photos. Then we’ll authorize payment.
</p>
<div className="card" style={{ maxWidth: 680 }}>

            {/* Quote summary */}
<div

              style={{

                padding: 14,

                border: "1px solid var(--border)",

                borderRadius: 8,

                background: "var(--surface-alt)",

                marginBottom: 22

              }}
>
<strong>Quote</strong>
<div style={{ marginTop: 8, fontSize: 18, fontWeight: 700 }}>

                {quotedPrice !== null ? `$${quotedPrice.toFixed(2)}` : "—"}
</div>
<div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>

                Authorization only (capture happens after delivery).
</div>
</div>
<h3 style={{ marginBottom: 12 }}>Recipient Information</h3>
<label>Full Name</label>
<input

              value={recipientName}

              onChange={(e) => setRecipientName(e.target.value)}

              placeholder="Recipient full name"

              style={{ width: "100%", marginBottom: 16 }}

            />
<label>Phone Number</label>
<input

              value={recipientPhone}

              onChange={(e) => setRecipientPhone(e.target.value)}

              placeholder="Recipient phone number"

              style={{ width: "100%", marginBottom: 16 }}

            />
<div style={{ marginBottom: 12 }}>
<label>
<input

                  type="checkbox"

                  checked={isBusiness}

                  onChange={() => setIsBusiness(!isBusiness)}

                />{" "}

                Delivery is to a business address
</label>
</div>

            {isBusiness && (
<>
<label>Business Delivery Hours</label>
<input

                  value={businessHours}

                  onChange={(e) => setBusinessHours(e.target.value)}

                  placeholder="e.g. Mon–Fri, 9am–5pm"

                  style={{ width: "100%", marginBottom: 16 }}

                />
</>

            )}
<div style={{ marginBottom: 24 }}>
<label>
<input

                  type="checkbox"

                  checked={needsSignature}

                  onChange={() => setNeedsSignature(!needsSignature)}

                />{" "}

                Require signature on delivery
</label>
</div>
<h3 style={{ marginBottom: 12 }}>Required Photos</h3>
<label>Pickup Photo (Required)</label>
<input

              type="file"

              accept="image/*"

              onChange={(e) => setPickupPhoto(e.target.files?.[0] || null)}

              style={{ width: "100%", marginBottom: 16 }}

            />
<label>Drop-off Photo (Required)</label>
<input

              type="file"

              accept="image/*"

              onChange={(e) => setDropoffPhoto(e.target.files?.[0] || null)}

              style={{ width: "100%", marginBottom: 24 }}

            />

            {error && (
<p style={{ color: "#dc2626", marginBottom: 16 }}>{error}</p>

            )}

            {!paymentIntentId ? (
<button

                style={{ width: "100%" }}

                onClick={createAuthorization}

                disabled={creatingAuth}
>

                {creatingAuth ? "Creating authorization…" : "Authorize Payment"}
</button>

            ) : (
<div

                style={{

                  padding: 16,

                  border: "1px solid var(--border)",

                  borderRadius: 8,

                  background: "var(--surface-alt)"

                }}
>
<strong>Authorization initialized</strong>
<p style={{ color: "var(--muted)", marginTop: 8 }}>

                  PaymentIntent created: <code>{paymentIntentId}</code>
</p>
<p style={{ color: "var(--muted)", marginTop: 8 }}>

                  Next step: add Stripe card entry (Elements) to complete the

                  authorization, then create the order + upload photos.
</p>
</div>

            )}
</div>
</div>
</main>
</AuthGuard>

  );

}
 
