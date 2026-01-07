"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* -------------------- TYPES -------------------- */

type DistanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; miles: number; text: string }
  | { status: "error"; message: string }
  | { status: "too_far"; miles: number; text: string };

/* -------------------- CONSTANTS -------------------- */

const MAX_MILES = 40;

// Pricing (current rules)
const BASE_FEE = 35;
const BASE_MILES_INCLUDED = 5;
const PER_MILE_RATE = 1.5;

// Weight surcharge
function weightSurcharge(lbs: number) {
  if (lbs <= 40) return 0;
  if (lbs <= 100) return 20;
  if (lbs <= 200) return 40;
  return null; // not allowed
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/* -------------------- COMPONENT -------------------- */

export default function QuoteClient() {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const pickupRef = useRef<HTMLInputElement | null>(null);
  const dropoffRef = useRef<HTMLInputElement | null>(null);

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [weight, setWeight] = useState<number | "">("");

  const [rush, setRush] = useState(false);
  const [signature, setSignature] = useState(false);

  const [distance, setDistance] = useState<DistanceState>({
    status: "idle",
  });

  /* -------------------- GOOGLE MAPS AUTOCOMPLETE (FIX) -------------------- */

  useEffect(() => {
    if (!apiKey) return;

    let cancelled = false;

    function initAutocomplete() {
      if (cancelled) return;
      const google = (window as any).google;
      if (!google?.maps?.places) return;

      if (pickupRef.current) {
        const pickupAuto = new google.maps.places.Autocomplete(
          pickupRef.current,
          { fields: ["formatted_address"] }
        );
        pickupAuto.addListener("place_changed", () => {
          const place = pickupAuto.getPlace();
          if (place?.formatted_address) {
            setPickup(place.formatted_address);
          }
        });
      }

      if (dropoffRef.current) {
        const dropoffAuto = new google.maps.places.Autocomplete(
          dropoffRef.current,
          { fields: ["formatted_address"] }
        );
        dropoffAuto.addListener("place_changed", () => {
          const place = dropoffAuto.getPlace();
          if (place?.formatted_address) {
            setDropoff(place.formatted_address);
          }
        });
      }
    }

    if ((window as any).google?.maps?.places) {
      initAutocomplete();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = initAutocomplete;
    script.onerror = () =>
      setDistance({
        status: "error",
        message: "Google Maps failed to load.",
      });

    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  /* -------------------- DISTANCE CALC -------------------- */

  const canCompute = pickup.length > 5 && dropoff.length > 5;

  useEffect(() => {
    if (!canCompute || !(window as any).google?.maps) return;

    const timer = setTimeout(() => {
      setDistance({ status: "loading" });

      const service = new (window as any).google.maps.DistanceMatrixService();
      service.getDistanceMatrix(
        {
          origins: [pickup],
          destinations: [dropoff],
          travelMode: (window as any).google.maps.TravelMode.DRIVING,
          unitSystem: (window as any).google.maps.UnitSystem.IMPERIAL,
        },
        (res: any, status: string) => {
          if (status !== "OK") {
            setDistance({
              status: "error",
              message: "Distance calculation failed.",
            });
            return;
          }

          const el = res?.rows?.[0]?.elements?.[0];
          if (!el || el.status !== "OK") {
            setDistance({
              status: "error",
              message: "Invalid addresses.",
            });
            return;
          }

          const miles = el.distance.value / 1609.344;
          const rounded = round2(miles);

          if (rounded > MAX_MILES) {
            setDistance({
              status: "too_far",
              miles: rounded,
              text: el.distance.text,
            });
            return;
          }

          setDistance({
            status: "ok",
            miles: rounded,
            text: el.distance.text,
          });
        }
      );
    }, 500);

    return () => clearTimeout(timer);
  }, [pickup, dropoff, canCompute]);

  /* -------------------- PRICING -------------------- */

  const pricing = useMemo(() => {
    if (distance.status !== "ok") return null;
    if (weight === "") return null;

    const w = Number(weight);
    const wFee = weightSurcharge(w);
    if (wFee === null) return { error: "Items over 200 lbs require special handling." };

    const billableMiles = Math.max(0, distance.miles - BASE_MILES_INCLUDED);
    const distanceFee = round2(billableMiles * PER_MILE_RATE);

    const rushFee = rush ? 10 : 0;
    const signatureFee = signature ? 5 : 0;

    const total = round2(
      BASE_FEE + distanceFee + wFee + rushFee + signatureFee
    );

    return {
      total,
      miles: distance.miles,
      billableMiles,
      distanceFee,
      weightFee: wFee,
      rushFee,
      signatureFee,
    };
  }, [distance, weight, rush, signature]);

  /* -------------------- CHECKOUT -------------------- */

  const goToCheckout = () => {
    if (!pricing || "error" in pricing) return;

    const qs = new URLSearchParams({
      price: pricing.total.toFixed(2),
      miles: String(pricing.miles),
      pickup,
      dropoff,
      weight: String(weight),
      rush: rush ? "1" : "0",
      signature: signature ? "1" : "0",
    });

    router.push(`/courier/checkout?${qs.toString()}`);
  };

  /* -------------------- UI -------------------- */

  return (
    <main style={{ padding: "96px 20px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1>Create Delivery</h1>

        <label>Pickup address</label>
        <input ref={pickupRef} value={pickup} onChange={(e) => setPickup(e.target.value)} />

        <label>Drop-off address</label>
        <input ref={dropoffRef} value={dropoff} onChange={(e) => setDropoff(e.target.value)} />

        <label>Weight (lbs)</label>
        <input
          type="number"
          value={weight}
          onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))}
        />

        {distance.status === "loading" && <p>Calculating distance…</p>}
        {distance.status === "ok" && (
          <p>{distance.text} ({distance.miles} miles)</p>
        )}
        {distance.status === "too_far" && (
          <p style={{ color: "red" }}>
            {distance.text} — exceeds service area.
          </p>
        )}
        {distance.status === "error" && (
          <p style={{ color: "red" }}>{distance.message}</p>
        )}

        {pricing && !("error" in pricing) && (
          <>
            <h2>${pricing.total.toFixed(2)}</h2>
            <button onClick={goToCheckout}>Continue to Checkout</button>
          </>
        )}
      </div>
    </main>
  );
}