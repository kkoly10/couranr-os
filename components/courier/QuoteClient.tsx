"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type DistanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; miles: number; text: string }
  | { status: "error"; message: string }
  | { status: "too_far"; miles: number; text: string };

const MAX_MILES = 40;

// Pricing (locked)
const BASE_FEE = 35;
const BASE_MILES_INCLUDED = 5;
const PER_MILE_RATE = 1.5;

// Weight pricing (safer)
function weightSurcharge(lbs: number) {
  if (lbs <= 40) return 0;
  if (lbs <= 100) return 20;
  if (lbs <= 200) return 40;
  return null; // not allowed
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function loadGoogleMaps(apiKey: string) {
  return new Promise<void>((resolve, reject) => {
    // If already loaded
    if (typeof window !== "undefined" && (window as any).google?.maps?.places) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps="true"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Google Maps failed to load"))
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
}

export default function QuoteClient() {
  const router = useRouter();

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const pickupRef = useRef<HTMLInputElement | null>(null);
  const dropoffRef = useRef<HTMLInputElement | null>(null);

  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [weight, setWeight] = useState<number | "">("");

  const [rush, setRush] = useState(false);
  const [needsSignature, setNeedsSignature] = useState(false);

  const [distance, setDistance] = useState<DistanceState>({ status: "idle" });

  // Init Places autocomplete once Maps is loaded
  useEffect(() => {
    if (!apiKey) {
      setDistance({
        status: "error",
        message:
          "Google Maps API key missing. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in Vercel."
      });
      return;
    }

    let canceled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (canceled) return;

        const google = (window as any).google;

        if (pickupRef.current) {
          const a = new google.maps.places.Autocomplete(pickupRef.current, {
            fields: ["formatted_address"]
          });
          a.addListener("place_changed", () => {
            const place = a.getPlace();
            const addr = place?.formatted_address || pickupRef.current!.value;
            setPickupAddress(addr);
          });
        }

        if (dropoffRef.current) {
          const b = new google.maps.places.Autocomplete(dropoffRef.current, {
            fields: ["formatted_address"]
          });
          b.addListener("place_changed", () => {
            const place = b.getPlace();
            const addr = place?.formatted_address || dropoffRef.current!.value;
            setDropoffAddress(addr);
          });
        }
      })
      .catch((err) => {
        setDistance({
          status: "error",
          message: err?.message || "Google Maps failed to load."
        });
      });

    return () => {
      canceled = true;
    };
  }, [apiKey]);

  const canComputeDistance = useMemo(() => {
    return pickupAddress.trim().length > 5 && dropoffAddress.trim().length > 5;
  }, [pickupAddress, dropoffAddress]);

  const computeDistance = async () => {
    if (!apiKey) return;

    if (!canComputeDistance) {
      setDistance({
        status: "error",
        message: "Enter both pickup and drop-off addresses."
      });
      return;
    }

    setDistance({ status: "loading" });

    try {
      await loadGoogleMaps(apiKey);
      const google = (window as any).google;

      const service = new google.maps.DistanceMatrixService();

      service.getDistanceMatrix(
        {
          origins: [pickupAddress],
          destinations: [dropoffAddress],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL
        },
        (response: any, status: string) => {
          if (status !== "OK") {
            setDistance({
              status: "error",
              message: "Distance service unavailable. Try again."
            });
            return;
          }

          const element = response?.rows?.[0]?.elements?.[0];
          if (!element || element.status !== "OK") {
            setDistance({
              status: "error",
              message: "Could not calculate distance. Check addresses."
            });
            return;
          }

          // distance.value in meters
          const meters = element.distance.value as number;
          const miles = meters / 1609.344;
          const milesRounded = round2(miles);
          const text = element.distance.text as string;

          if (miles > MAX_MILES) {
            setDistance({ status: "too_far", miles: milesRounded, text });
            return;
          }

          setDistance({ status: "ok", miles: milesRounded, text });
        }
      );
    } catch (e: any) {
      setDistance({
        status: "error",
        message: e?.message || "Failed to calculate distance."
      });
    }
  };

  // Auto-recompute when both addresses filled (feels “live”)
  useEffect(() => {
    if (!canComputeDistance) return;
    const t = setTimeout(() => computeDistance(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupAddress, dropoffAddress]);

  const pricing = useMemo(() => {
    if (distance.status !== "ok") return null;
    if (weight === "") return null;

    const w = Number(weight);
    const wFee = weightSurcharge(w);
    if (wFee === null) return { error: "Over 200 lbs (not accepted)" };

    const billableMiles = Math.max(0, distance.miles - BASE_MILES_INCLUDED);
    const distanceFee = round2(billableMiles * PER_MILE_RATE);

    const rushFee = rush ? 10 : 0;
    const signatureFee = needsSignature ? 5 : 0;

    const total = round2(BASE_FEE + distanceFee + wFee + rushFee + signatureFee);

    return {
      base: BASE_FEE,
      miles: distance.miles,
      billableMiles: round2(billableMiles),
      distanceFee,
      weightFee: wFee,
      rushFee,
      signatureFee,
      total
    };
  }, [distance, weight, rush, needsSignature]);

  const goToCheckout = () => {
    if (!pricing || "error" in pricing) return;

    const qs = new URLSearchParams({
      price: pricing.total.toFixed(2),
      miles: String(pricing.miles),
      pickup: pickupAddress,
      dropoff: dropoffAddress,
      weight: String(weight),
      rush: rush ? "1" : "0",
      signature: needsSignature ? "1" : "0"
    });

    router.push(`/courier/checkout?${qs.toString()}`);
  };

  return (
    <main style={{ padding: "100px 20px" }}>
      <div className="container">
        <h1>Create Delivery</h1>
        <p style={{ color: "var(--muted)", marginBottom: 24 }}>
          Enter addresses to calculate distance and price instantly.
        </p>

        <div className="card" style={{ maxWidth: 760 }}>
          <label>Pickup Address</label>
          <input
            ref={pickupRef}
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            placeholder="Start typing an address…"
            style={{ width: "100%", marginBottom: 16 }}
          />

          <label>Drop-off Address</label>
          <input
            ref={dropoffRef}
            value={dropoffAddress}
            onChange={(e) => setDropoffAddress(e.target.value)}
            placeholder="Start typing an address…"
            style={{ width: "100%", marginBottom: 16 }}
          />

          <label>Estimated Package Weight (lbs)</label>
          <input
            type="number"
            min={0}
            max={200}
            value={weight}
            onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="0–200"
            style={{ width: "100%", marginBottom: 16 }}
          />

          <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={rush}
                onChange={() => setRush(!rush)}
              />
              Rush (+$10) — pickup within 2 hours
            </label>

            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={needsSignature}
                onChange={() => setNeedsSignature(!needsSignature)}
              />
              Signature recommended for items valued over $100 (+$5)
            </label>
          </div>

          {/* Distance panel */}
          <div
            style={{
              padding: 14,
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface-alt)",
              marginBottom: 18
            }}
          >
            <strong>Distance</strong>
            <div style={{ marginTop: 8 }}>
              {distance.status === "idle" && (
                <span style={{ color: "var(--muted)" }}>
                  Enter pickup and drop-off addresses.
                </span>
              )}
              {distance.status === "loading" && (
                <span style={{ color: "var(--muted)" }}>Calculating…</span>
              )}
              {distance.status === "ok" && (
                <span>
                  {distance.text} ({distance.miles} miles)
                </span>
              )}
              {distance.status === "too_far" && (
                <span style={{ color: "#dc2626" }}>
                  {distance.text} ({distance.miles} miles) — over 40 miles. Call for a custom quote.
                </span>
              )}
              {distance.status === "error" && (
                <span style={{ color: "#dc2626" }}>{distance.message}</span>
              )}
            </div>
          </div>

          {/* Price panel */}
          <div
            style={{
              padding: 14,
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface-alt)"
            }}
          >
            <strong>Price</strong>

            {!pricing && (
              <div style={{ marginTop: 10, color: "var(--muted)" }}>
                Distance and weight are required to generate a quote.
              </div>
            )}

            {pricing && "error" in pricing && (
              <div style={{ marginTop: 10, color: "#dc2626" }}>{pricing.error}</div>
            )}

            {pricing && !("error" in pricing) && (
              <>
                <div style={{ fontSize: 26, fontWeight: 800, marginTop: 10 }}>
                  ${pricing.total.toFixed(2)}
                </div>

                <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>
                  Includes {BASE_MILES_INCLUDED} miles. Max distance: {MAX_MILES} miles. Max weight: 200 lbs.
                </div>

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer" }}>View price breakdown</summary>
                  <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 14 }}>
                    <div>Base fee: ${pricing.base.toFixed(2)}</div>
                    <div>
                      Distance fee: ${pricing.distanceFee.toFixed(2)} (
                      {pricing.billableMiles} billable miles × ${PER_MILE_RATE.toFixed(2)})
                    </div>
                    <div>Weight fee: ${pricing.weightFee.toFixed(2)}</div>
                    {pricing.rushFee > 0 && <div>Rush fee: ${pricing.rushFee.toFixed(2)}</div>}
                    {pricing.signatureFee > 0 && (
                      <div>Signature fee: ${pricing.signatureFee.toFixed(2)}</div>
                    )}
                  </div>
                </details>

                <button style={{ width: "100%", marginTop: 16 }} onClick={goToCheckout}>
                  Continue to Checkout
                </button>

                <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 12 }}>
                  Safety note: Drivers may refuse pickup if the item appears unsafe, exceeds declared weight,
                  or requires more than one person to lift. Support may contact you to adjust pricing or cancel the order.
                </p>
              </>
            )}
          </div>

          <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 12 }}>
            If distance cannot be calculated, double-check addresses or try selecting from the dropdown suggestions.
          </div>
        </div>
      </div>
    </main>
  );
}
