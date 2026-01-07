"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";

/* -------------------- TYPES -------------------- */

type DistanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; miles: number; text: string }
  | { status: "too_far"; miles: number; text: string }
  | { status: "error"; message: string };

/* -------------------- LIMITS -------------------- */

const MAX_MILES = 40;
const MAX_WEIGHT = 100;

/* -------------------- GOOGLE MAPS -------------------- */

function loadGoogleMaps(apiKey: string) {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).google?.maps?.places) return resolve();

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
}

/* -------------------- COMPONENT -------------------- */

export default function QuoteClient() {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;

  const pickupRef = useRef<HTMLInputElement | null>(null);
  const dropoffRef = useRef<HTMLInputElement | null>(null);

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [weight, setWeight] = useState<number | "">("");
  const [stops, setStops] = useState(0);
  const [rush, setRush] = useState(false);
  const [signature, setSignature] = useState(false);

  const [distance, setDistance] = useState<DistanceState>({
    status: "idle",
  });

  /* -------------------- AUTOCOMPLETE -------------------- */

  useEffect(() => {
    if (!apiKey) return;

    loadGoogleMaps(apiKey)
      .then(() => {
        const google = (window as any).google;

        if (pickupRef.current) {
          const a = new google.maps.places.Autocomplete(pickupRef.current, {
            fields: ["formatted_address"],
          });
          a.addListener("place_changed", () => {
            setPickup(a.getPlace()?.formatted_address || "");
          });
        }

        if (dropoffRef.current) {
          const b = new google.maps.places.Autocomplete(dropoffRef.current, {
            fields: ["formatted_address"],
          });
          b.addListener("place_changed", () => {
            setDropoff(b.getPlace()?.formatted_address || "");
          });
        }
      })
      .catch(() =>
        setDistance({
          status: "error",
          message: "Google Maps failed to load",
        })
      );
  }, [apiKey]);

  /* -------------------- DISTANCE -------------------- */

  useEffect(() => {
    if (pickup.length < 6 || dropoff.length < 6) return;

    setDistance({ status: "loading" });

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
          setDistance({
            status: "error",
            message: "Distance unavailable",
          });
          return;
        }

        const el = res.rows[0].elements[0];
        const miles = el.distance.value / 1609.344;
        const rounded = Math.round(miles * 100) / 100;

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
  }, [pickup, dropoff]);

  /* -------------------- PRICING -------------------- */

  const pricing = useMemo(() => {
    if (distance.status !== "ok") return null;
    if (weight === "") return null;

    try {
      return computeDeliveryPrice({
        miles: distance.miles,
        weightLbs: Number(weight),
        stops,
        rush,
        signature,
      });
    } catch (e: any) {
      return { error: e.message };
    }
  }, [distance, weight, stops, rush, signature]);

  /* -------------------- CHECKOUT -------------------- */

  const goToCheckout = () => {
    if (!pricing || "error" in pricing) return;

    const qs = new URLSearchParams({
      price: (pricing.amountCents / 100).toFixed(2),
      miles: String(distance.status === "ok" ? distance.miles : 0),
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
    <main style={{ padding: "96px 20px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1>Courier Delivery Quote</h1>

        <div className="card">
          <label>Pickup address</label>
          <input ref={pickupRef} />

          <label>Drop-off address</label>
          <input ref={dropoffRef} />

          <label>Weight (lbs)</label>
          <input
            type="number"
            max={MAX_WEIGHT}
            value={weight}
            onChange={(e) =>
              setWeight(e.target.value === "" ? "" : Number(e.target.value))
            }
          />

          <label>Extra stops</label>
          <input
            type="number"
            min={0}
            max={3}
            value={stops}
            onChange={(e) => setStops(Number(e.target.value))}
          />

          <label>
            <input type="checkbox" checked={rush} onChange={() => setRush(!rush)} />
            Rush (+$10)
          </label>

          <label>
            <input
              type="checkbox"
              checked={signature}
              onChange={() => setSignature(!signature)}
            />
            Signature (+$5)
          </label>

          {distance.status === "loading" && <p>Calculating distance…</p>}
          {distance.status === "ok" && (
            <p>{distance.text} ({distance.miles} miles)</p>
          )}
          {distance.status === "too_far" && (
            <p style={{ color: "red" }}>
              Over {MAX_MILES} miles — special request required
            </p>
          )}

          {pricing && "error" in pricing && (
            <p style={{ color: "red" }}>{pricing.error}</p>
          )}

          {pricing && !("error" in pricing) && (
            <>
              <h2>${(pricing.amountCents / 100).toFixed(2)}</h2>

              <details>
                <summary>View price breakdown</summary>
                <ul>
                  <li>Base: ${pricing.breakdown.base}</li>
                  <li>Extra miles: ${pricing.breakdown.extraMiles}</li>
                  <li>Weight: ${pricing.breakdown.weightSurcharge}</li>
                  <li>Stops: ${pricing.breakdown.stops}</li>
                  <li>Rush: ${pricing.breakdown.rush}</li>
                  <li>Signature: ${pricing.breakdown.signature}</li>
                </ul>
              </details>

              <button onClick={goToCheckout}>
                Continue to checkout
              </button>

              <p style={{ fontSize: 12, color: "#666" }}>
                Orders placed after 4 PM may be scheduled for the next business day.
                Heavy or unsafe items may be refused at pickup.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}