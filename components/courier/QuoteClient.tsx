"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* -------------------- CONFIG -------------------- */

const MAX_MILES = 40;
const MAX_WEIGHT = 100;

// Pricing (FINAL)
const BASE_FEE = 15;
const INCLUDED_MILES = 4;
const PER_MILE_RATE = 1.75;
const STOP_FEE = 6;
const RUSH_FEE = 10;
const SIGNATURE_FEE = 5;

/* -------------------- HELPERS -------------------- */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function isWithinBusinessHours(d: Date) {
  const h = d.getHours();
  return h >= 9 && h < 18;
}

function isAfterCutoff(d: Date) {
  return d.getHours() >= 16;
}

function loadGoogleMaps(apiKey: string) {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).google?.maps?.places) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
}

/* -------------------- COMPONENT -------------------- */

export default function QuoteClient() {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;

  const pickupRef = useRef<HTMLInputElement>(null);
  const dropoffRef = useRef<HTMLInputElement>(null);

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [weight, setWeight] = useState<number | "">("");
  const [stops, setStops] = useState(0);
  const [rush, setRush] = useState(false);
  const [signature, setSignature] = useState(false);

  const [miles, setMiles] = useState<number | null>(null);
  const [distanceText, setDistanceText] = useState<string | null>(null);
  const [distanceError, setDistanceError] = useState<string | null>(null);

  const now = new Date();
  const afterCutoff = isAfterCutoff(now);
  const outsideHours = !isWithinBusinessHours(now);

  /* -------------------- GOOGLE AUTOCOMPLETE -------------------- */

  useEffect(() => {
    if (!apiKey) return;

    loadGoogleMaps(apiKey).then(() => {
      const google = (window as any).google;

      if (pickupRef.current) {
        const a = new google.maps.places.Autocomplete(pickupRef.current);
        a.addListener("place_changed", () => {
          setPickup(a.getPlace()?.formatted_address || "");
        });
      }

      if (dropoffRef.current) {
        const b = new google.maps.places.Autocomplete(dropoffRef.current);
        b.addListener("place_changed", () => {
          setDropoff(b.getPlace()?.formatted_address || "");
        });
      }
    });
  }, [apiKey]);

  /* -------------------- DISTANCE -------------------- */

  useEffect(() => {
    if (!pickup || !dropoff) return;

    const google = (window as any).google;
    if (!google?.maps) return;

    const svc = new google.maps.DistanceMatrixService();
    svc.getDistanceMatrix(
      {
        origins: [pickup],
        destinations: [dropoff],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
      },
      (res: any, status: string) => {
        if (status !== "OK") {
          setDistanceError("Unable to calculate distance");
          return;
        }

        const el = res.rows[0].elements[0];
        if (el.status !== "OK") {
          setDistanceError("Invalid addresses");
          return;
        }

        const m = el.distance.value / 1609.344;
        setMiles(round2(m));
        setDistanceText(el.distance.text);
        setDistanceError(null);
      }
    );
  }, [pickup, dropoff]);

  /* -------------------- PRICING -------------------- */

  const pricing = useMemo(() => {
    if (miles === null || weight === "") return null;
    if (miles > MAX_MILES) return { error: "Long distance — custom quote required" };
    if (weight > MAX_WEIGHT) return { error: "Heavy item — custom handling required" };

    const extraMiles = Math.max(0, miles - INCLUDED_MILES);
    const extraMilesFee = round2(extraMiles * PER_MILE_RATE);
    const stopsFee = stops * STOP_FEE;
    const rushFee = rush ? RUSH_FEE : 0;
    const signatureFee = signature ? SIGNATURE_FEE : 0;

    const total = round2(
      BASE_FEE + extraMilesFee + stopsFee + rushFee + signatureFee
    );

    return {
      total,
      breakdown: {
        base: BASE_FEE,
        includedMiles: INCLUDED_MILES,
        totalMiles: miles,
        billableMiles: extraMiles,
        perMileRate: PER_MILE_RATE,
        extraMilesFee,
        stopsFee,
        rushFee,
        signatureFee,
        total,
      },
    };
  }, [miles, weight, stops, rush, signature]);

  /* -------------------- CHECKOUT -------------------- */

  const continueToCheckout = () => {
    if (!pricing || "error" in pricing) return;

    const qs = new URLSearchParams({
      price: pricing.total.toFixed(2),
      miles: String(miles),
      pickup,
      dropoff,
      weight: String(weight),
      stops: String(stops),
      rush: rush ? "1" : "0",
      signature: signature ? "1" : "0",
    });

    router.push(`/courier/checkout?${qs.toString()}`);
  };

  /* -------------------- UI -------------------- */

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 32 }}>Courier Delivery Quote</h1>

      {(afterCutoff || outsideHours) && (
        <div style={warningBox}>
          Orders placed after <strong>4:00 PM</strong> or outside business hours
          will be scheduled for the next business day.
        </div>
      )}

      <div style={card}>
        <label>Pickup address</label>
        <input ref={pickupRef} placeholder="Start typing…" />

        <label>Drop-off address</label>
        <input ref={dropoffRef} placeholder="Start typing…" />

        {distanceText && (
          <p>
            Distance: <strong>{distanceText}</strong> ({miles} miles)
          </p>
        )}
        {distanceError && <p style={{ color: "red" }}>{distanceError}</p>}

        <label>Weight (lbs)</label>
        <input
          type="number"
          value={weight}
          onChange={(e) =>
            setWeight(e.target.value === "" ? "" : Number(e.target.value))
          }
        />

        <label>Additional stops</label>
        <input
          type="number"
          min={0}
          max={3}
          value={stops}
          onChange={(e) => setStops(Number(e.target.value))}
        />

        <label>
          <input type="checkbox" checked={rush} onChange={() => setRush(!rush)} />
          Rush (+${RUSH_FEE})
        </label>

        <label>
          <input
            type="checkbox"
            checked={signature}
            onChange={() => setSignature(!signature)}
          />
          Signature required (+${SIGNATURE_FEE})
        </label>
      </div>

      <div style={card}>
        <h2>Price</h2>

        {!pricing && <p>Enter details to see pricing.</p>}

        {pricing && "error" in pricing && (
          <p style={{ color: "red" }}>{pricing.error}</p>
        )}

        {pricing && !("error" in pricing) && (
          <>
            <div style={{ fontSize: 28, fontWeight: 800 }}>
              ${pricing.total.toFixed(2)}
            </div>

            <ul style={{ marginTop: 12 }}>
              <li>
                Base fee: ${pricing.breakdown.base.toFixed(2)}{" "}
                <em>(includes first {pricing.breakdown.includedMiles} miles)</em>
              </li>
              <li>
                Distance: {pricing.breakdown.totalMiles} miles total →{" "}
                {pricing.breakdown.billableMiles} billable miles × $
                {pricing.breakdown.perMileRate.toFixed(2)} = $
                {pricing.breakdown.extraMilesFee.toFixed(2)}
              </li>
              <li>Stops: ${pricing.breakdown.stopsFee.toFixed(2)}</li>
              <li>Rush: ${pricing.breakdown.rushFee.toFixed(2)}</li>
              <li>Signature: ${pricing.breakdown.signatureFee.toFixed(2)}</li>
            </ul>

            <button onClick={continueToCheckout} style={primaryBtn}>
              Continue to checkout
            </button>

            <p style={{ fontSize: 12, color: "#555", marginTop: 12 }}>
              Drivers may refuse unsafe, overweight, or misdeclared items.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

/* -------------------- STYLES -------------------- */

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 16,
  marginTop: 16,
  background: "#fff",
};

const primaryBtn: React.CSSProperties = {
  marginTop: 16,
  padding: "12px 16px",
  background: "#111827",
  color: "#fff",
  borderRadius: 10,
  fontWeight: 700,
};

const warningBox: React.CSSProperties = {
  border: "1px solid #fde68a",
  background: "#fffbeb",
  padding: 12,
  borderRadius: 10,
  marginBottom: 16,
};