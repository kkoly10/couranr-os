"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import AuthGuard from "../../components/AuthGuard";

export default function CourierPage() {

  const router = useRouter();

  const [pickupAddress, setPickupAddress] = useState("");

  const [dropoffAddress, setDropoffAddress] = useState("");

  const [weight, setWeight] = useState<number | "">("");

  const [isBusiness, setIsBusiness] = useState(false);

  const [needsSignature, setNeedsSignature] = useState(false);

  const [calculated, setCalculated] = useState(false);

  const [price, setPrice] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);

  /**

   * TEMPORARY distance stub

   * (Google Maps will replace this next)

   */

  const mockDistanceMiles = 18;

  const BASE_PRICE = 35;

  const calculatePrice = () => {

    setError(null);

    setCalculated(false);

    setPrice(null);

    if (!pickupAddress || !dropoffAddress || weight === "") {

      setError("Please complete all required fields.");

      return;

    }

    if (mockDistanceMiles > 40) {

      setError(

        "This delivery exceeds our 40-mile service radius. Please call to receive a custom quote."

      );

      return;

    }

    if (weight > 200) {

      setError(

        "Items over 200 lbs require special handling. Please call for a quote."

      );

      return;

    }

    let total = BASE_PRICE;

    // Weight tiers

    if (weight > 40 && weight <= 100) total += 15;

    else if (weight > 100 && weight <= 200) total += 30;

    // Signature surcharge placeholder

    if (needsSignature) total += 5;

    setPrice(total);

    setCalculated(true);

  };

  const continueToCheckout = () => {

    if (!calculated || price === null) return;

    const params = new URLSearchParams({

      price: price.toFixed(2),

      signature: needsSignature ? "1" : "0",

      business: isBusiness ? "1" : "0"

    });

    router.push(`/courier/checkout?${params.toString()}`);

  };

  return (
<AuthGuard>
<main style={{ padding: "100px 20px" }}>
<div className="container">
<h1>Create Delivery</h1>
<p style={{ color: "var(--muted)", marginBottom: 32 }}>

            Enter delivery details to calculate your price.
</p>
<div className="card" style={{ maxWidth: 620 }}>
<label>Pickup Address</label>
<input

              value={pickupAddress}

              onChange={(e) => setPickupAddress(e.target.value)}

              placeholder="Enter pickup address"

              style={{ width: "100%", marginBottom: 16 }}

            />
<label>Drop-off Address</label>
<input

              value={dropoffAddress}

              onChange={(e) => setDropoffAddress(e.target.value)}

              placeholder="Enter drop-off address"

              style={{ width: "100%", marginBottom: 16 }}

            />
<label>Estimated Package Weight (lbs)</label>
<input

              type="number"

              min={0}

              max={200}

              value={weight}

              onChange={(e) =>

                setWeight(e.target.value === "" ? "" : Number(e.target.value))

              }

              placeholder="0–200 lbs"

              style={{ width: "100%", marginBottom: 16 }}

            />
<div style={{ marginBottom: 12 }}>
<label>
<input

                  type="checkbox"

                  checked={isBusiness}

                  onChange={() => setIsBusiness(!isBusiness)}

                />{" "}

                Drop-off is a business address
</label>
</div>
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
<button onClick={calculatePrice} style={{ width: "100%" }}>

              Calculate Price
</button>

            {error && (
<p style={{ color: "#dc2626", marginTop: 16 }}>{error}</p>

            )}

            {calculated && price !== null && (
<div

                style={{

                  marginTop: 24,

                  padding: 16,

                  border: "1px solid var(--border)",

                  borderRadius: 8,

                  background: "var(--surface-alt)"

                }}
>
<strong>Estimated Price</strong>
<p style={{ marginTop: 8, fontSize: 22, fontWeight: 700 }}>

                  ${price.toFixed(2)}
</p>
<p style={{ color: "var(--muted)", fontSize: 14 }}>

                  Online quotes apply up to 40 miles. Photos required at pickup

                  and drop-off.
</p>
<button

                  style={{ marginTop: 16, width: "100%" }}

                  onClick={continueToCheckout}
>

                  Continue to Checkout
</button>
</div>

            )}
</div>
</div>
</main>
</AuthGuard>

  );

}
 
