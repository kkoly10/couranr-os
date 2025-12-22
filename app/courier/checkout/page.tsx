"use client";

import { useState } from "react";

import AuthGuard from "../../../components/AuthGuard";

export default function CourierCheckoutPage() {

  const [recipientName, setRecipientName] = useState("");

  const [recipientPhone, setRecipientPhone] = useState("");

  const [isBusiness, setIsBusiness] = useState(false);

  const [businessHours, setBusinessHours] = useState("");

  const [needsSignature, setNeedsSignature] = useState(false);

  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);

  const [dropoffPhoto, setDropoffPhoto] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {

    setError(null);

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

    // Payment + order creation will happen next step

    setSubmitted(true);

  };

  return (
<AuthGuard>
<main style={{ padding: "100px 20px" }}>
<div className="container">
<h1>Checkout</h1>
<p style={{ color: "var(--muted)", marginBottom: 32 }}>

            Review delivery details and provide recipient information.
</p>
<div className="card" style={{ maxWidth: 640 }}>

            {/* Recipient Info */}
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

            {/* Signature */}
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

            {/* Photos */}
<h3 style={{ marginBottom: 12 }}>Required Photos</h3>
<label>Pickup Photo (Required)</label>
<input

              type="file"

              accept="image/*"

              onChange={(e) =>

                setPickupPhoto(e.target.files?.[0] || null)

              }

              style={{ width: "100%", marginBottom: 16 }}

            />
<label>Drop-off Photo (Required)</label>
<input

              type="file"

              accept="image/*"

              onChange={(e) =>

                setDropoffPhoto(e.target.files?.[0] || null)

              }

              style={{ width: "100%", marginBottom: 24 }}

            />

            {/* Error */}

            {error && (
<p style={{ color: "#dc2626", marginBottom: 16 }}>{error}</p>

            )}

            {/* Submit */}

            {!submitted ? (
<button style={{ width: "100%" }} onClick={handleSubmit}>

                Confirm & Continue
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
<strong>Details confirmed</strong>
<p style={{ color: "var(--muted)", marginTop: 8 }}>

                  Next step: payment and order confirmation.
</p>
</div>

            )}
</div>
</div>
</main>
</AuthGuard>

  );

}
 
