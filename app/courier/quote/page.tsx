"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* -------------------- CONFIG -------------------- */

const MAX_MILES = 40;
const MAX_WEIGHT = 100;

// Pricing
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
    if (typeof window === "undefined") {
      reject(new Error("Window not available"));
      return;
    }

    const w = window as any;

    if (w.google?.maps?.places) {
      resolve();
      return;
    }

    // Reuse one shared loader promise if already loading
    if (w.__couranrMapsLoaderPromise) {
      w.__couranrMapsLoaderPromise.then(resolve).catch(reject);
      return;
    }

    w.__couranrMapsLoaderPromise = new Promise<void>((res, rej) => {
      const existing = document.getElementById("google-maps-js");
      if (existing) {
        existing.addEventListener("load", () => res(), { once: true });
        existing.addEventListener("error", () => rej(new Error("Failed to load Google Maps")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.id = "google-maps-js";
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = () => res();
      script.onerror = () => rej(new Error("Failed to load Google Maps"));
      document.head.appendChild(script);
    });

    w.__couranrMapsLoaderPromise.then(resolve).catch(reject);
  });
}

/* -------------------- PAGE -------------------- */

export default function CourierQuotePage() {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

  const pickupRef = useRef<HTMLInputElement>(null);
  const dropoffRef = useRef<HTMLInputElement>(null);

  const pickupAutocompleteBound = useRef(false);
  const dropoffAutocompleteBound = useRef(false);

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);

  const [isAuthed, setIsAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

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

  /* -------------------- AUTH STATE -------------------- */

  useEffect(() => {
    let active = true;

    async function loadSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active) return;
      setIsAuthed(!!session);
      setAuthLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  /* -------------------- LOAD GOOGLE MAPS -------------------- */

  useEffect(() => {
    if (!apiKey) {
      setMapsError(
        "Google Maps API key is missing. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in Vercel and redeploy."
      );
      return;
    }

    loadGoogleMaps(apiKey)
      .then(() => {
        setMapsReady(true);
        setMapsError(null);
      })
      .catch((err) => {
        setMapsError(err?.message || "Failed to load Google Maps");
      });
  }, [apiKey]);

  /* -------------------- GOOGLE AUTOCOMPLETE -------------------- */

  useEffect(() => {
    if (!mapsReady) return;

    const google = (window as any).google;
    if (!google?.maps?.places) return;

    if (pickupRef.current && !pickupAutocompleteBound.current) {
      const a = new google.maps.places.Autocomplete(pickupRef.current, {
        fields: ["formatted_address"],
      });

      a.addListener("place_changed", () => {
        const p = a.getPlace();
        setPickup(p?.formatted_address || pickupRef.current?.value || "");
      });

      pickupAutocompleteBound.current = true;
    }

    if (dropoffRef.current && !dropoffAutocompleteBound.current) {
      const b = new google.maps.places.Autocomplete(dropoffRef.current, {
        fields: ["formatted_address"],
      });

      b.addListener("place_changed", () => {
        const p = b.getPlace();
        setDropoff(p?.formatted_address || dropoffRef.current?.value || "");
      });

      dropoffAutocompleteBound.current = true;
    }
  }, [mapsReady]);

  /* -------------------- DISTANCE CALC -------------------- */

  useEffect(() => {
    if (!mapsReady) return;

    if (!pickup.trim() || !dropoff.trim()) {
      setMiles(null);
      setDistanceText(null);
      setDistanceError(null);
      return;
    }

    const google = (window as any).google;
    if (!google?.maps?.DistanceMatrixService) return;

    const timer = setTimeout(() => {
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
            setDistanceError("Unable to calculate distance. Check addresses.");
            setMiles(null);
            setDistanceText(null);
            return;
          }

          const el = res?.rows?.[0]?.elements?.[0];
          if (!el || el.status !== "OK") {
            setDistanceError("Invalid pickup or drop-off address.");
            setMiles(null);
            setDistanceText(null);
            return;
          }

          const m = el.distance.value / 1609.344;
          setMiles(round2(m));
          setDistanceText(el.distance.text);
          setDistanceError(null);
        }
      );
    }, 350);

    return () => clearTimeout(timer);
  }, [pickup, dropoff, mapsReady]);

  /* -------------------- PRICING -------------------- */

  const pricing = useMemo(() => {
    if (miles === null || weight === "") return null;
    if (miles > MAX_MILES) return { error: "Long distance — custom quote required" as const };
    if (weight > MAX_WEIGHT) return { error: "Heavy item — custom handling required" as const };

    const extraMiles = Math.max(0, miles - INCLUDED_MILES);
    const extraMilesFee = round2(extraMiles * PER_MILE_RATE);
    const stopsFee = stops * STOP_FEE;
    const rushFee = rush ? RUSH_FEE : 0;
    const signatureFee = signature ? SIGNATURE_FEE : 0;

    const total = round2(BASE_FEE + extraMilesFee + stopsFee + rushFee + signatureFee);

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

  /* -------------------- CONTINUE -------------------- */

  async function handleContinue() {
    if (!pricing || "error" in pricing) return;
    if (miles === null || weight === "") return;

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

    // Re-check auth in case state is stale
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      const next = `/courier/quote?${qs.toString()}`;
      router.push(`/signup?next=${encodeURIComponent(next)}`);
      return;
    }

    router.push(`/courier/checkout?${qs.toString()}`);
  }

  const continueLabel = authLoading
    ? "Checking account…"
    : isAuthed
    ? "Continue to checkout"
    : "Create account to continue";

  /* -------------------- UI -------------------- */

  return (
    <main className="page">
      <div className="cContainer" style={{ maxWidth: 980 }}>
        <div className="pageHeader">
          <div>
            <h1 className="pageTitle">Courier Delivery Quote</h1>
            <p className="pageSub">
              Enter pickup and drop-off addresses for an exact distance-based quote.
            </p>
          </div>
        </div>

        {(afterCutoff || outsideHours) && (
          <div
            className="notice"
            style={{
              border: "1px solid #fde68a",
              background: "#fffbeb",
              color: "#92400e",
              marginBottom: 16,
            }}
          >
            Orders placed after <strong>4:00 PM</strong> or outside business hours may be
            scheduled for the next business day.
          </div>
        )}

        {mapsError && (
          <div className="notice noticeError" style={{ marginBottom: 16 }}>
            <strong>Google Maps:</strong> {mapsError}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "1.1fr 0.9fr",
            alignItems: "start",
          }}
        >
          {/* LEFT: FORM */}
          <div className="card">
            <div className="cardIcon" aria-hidden="true">
              🚚
            </div>
            <h2 className="cardTitle">Delivery details</h2>
            <p className="cardDesc">
              Use full addresses. If autocomplete appears, select the best match.
            </p>

            <div className="field">
              <div className="label">Pickup address</div>
              <input
                ref={pickupRef}
                className="input"
                placeholder="Start typing pickup address…"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="field">
              <div className="label">Drop-off address</div>
              <input
                ref={dropoffRef}
                className="input"
                placeholder="Start typing drop-off address…"
                value={dropoff}
                onChange={(e) => setDropoff(e.target.value)}
                autoComplete="off"
              />
            </div>

            {distanceText && miles !== null && (
              <div
                className="notice"
                style={{
                  marginTop: 10,
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                Distance: <strong>{distanceText}</strong> ({miles} miles)
              </div>
            )}

            {distanceError && (
              <p style={{ color: "#ef4444", marginTop: 8, marginBottom: 0 }}>{distanceError}</p>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginTop: 12,
              }}
            >
              <div className="field" style={{ marginBottom: 0 }}>
                <div className="label">Package weight (lbs)</div>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={500}
                  value={weight}
                  onChange={(e) =>
                    setWeight(e.target.value === "" ? "" : Number(e.target.value))
                  }
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <div className="label">Additional stops</div>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={3}
                  value={stops}
                  onChange={(e) => setStops(Math.max(0, Math.min(3, Number(e.target.value || 0))))}
                />
              </div>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                <input type="checkbox" checked={rush} onChange={() => setRush((v) => !v)} />
                Rush / priority delivery (+${RUSH_FEE})
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                <input
                  type="checkbox"
                  checked={signature}
                  onChange={() => setSignature((v) => !v)}
                />
                Signature required (+${SIGNATURE_FEE})
              </label>
            </div>

            <p className="finePrint" style={{ marginTop: 14 }}>
              Max automated quote: {MAX_MILES} miles and {MAX_WEIGHT} lbs. Larger jobs may require a
              custom quote.
            </p>
          </div>

          {/* RIGHT: PRICE */}
          <div className="card">
            <div className="cardIcon" aria-hidden="true">
              💰
            </div>
            <h2 className="cardTitle">Quote summary</h2>
            <p className="cardDesc">
              Exact quote appears after address distance is calculated.
            </p>

            {!pricing && (
              <p className="muted" style={{ marginTop: 8 }}>
                Enter addresses and package details to see pricing.
              </p>
            )}

            {pricing && "error" in pricing && (
              <div className="notice noticeError" style={{ marginTop: 10 }}>
                {pricing.error}
              </div>
            )}

            {pricing && !("error" in pricing) && (
              <>
                <div style={{ fontSize: 30, fontWeight: 900, marginTop: 8 }}>
                  ${pricing.total.toFixed(2)}
                </div>

                <ul className="cardList" style={{ marginTop: 10 }}>
                  <li>
                    Base fee: ${pricing.breakdown.base.toFixed(2)} (includes first{" "}
                    {pricing.breakdown.includedMiles} miles)
                  </li>
                  <li>
                    Distance: {pricing.breakdown.totalMiles} miles total →{" "}
                    {pricing.breakdown.billableMiles} billable × $
                    {pricing.breakdown.perMileRate.toFixed(2)} = $
                    {pricing.breakdown.extraMilesFee.toFixed(2)}
                  </li>
                  <li>Stops: ${pricing.breakdown.stopsFee.toFixed(2)}</li>
                  <li>Rush: ${pricing.breakdown.rushFee.toFixed(2)}</li>
                  <li>Signature: ${pricing.breakdown.signatureFee.toFixed(2)}</li>
                </ul>

                <button
                  onClick={handleContinue}
                  disabled={authLoading}
                  className="btn btnGold"
                  style={{ marginTop: 14, width: "100%" }}
                >
                  {continueLabel}
                </button>

                {!isAuthed && !authLoading && (
                  <p className="finePrint" style={{ marginTop: 10 }}>
                    You’ll be redirected to create an account first, then you can continue with this
                    quote.
                  </p>
                )}

                {isAuthed && (
                  <p className="finePrint" style={{ marginTop: 10 }}>
                    You’ll review delivery details and pay securely before submission.
                  </p>
                )}
              </>
            )}

            <div
              style={{
                marginTop: 14,
                borderTop: "1px solid rgba(255,255,255,0.08)",
                paddingTop: 12,
              }}
            >
              <p className="finePrint" style={{ margin: 0 }}>
                Drivers may refuse unsafe, overweight, prohibited, or misdeclared items.
              </p>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="cardTitle" style={{ marginBottom: 8 }}>
            Prohibited items
          </h3>
          <ul className="cardList">
            <li>Illegal items</li>
            <li>Hazardous materials</li>
            <li>Weapons or restricted items</li>
            <li>Anything unsafe to transport</li>
          </ul>
        </div>
      </div>

      {/* Simple responsive tweak without touching globals.css */}
      <style jsx>{`
        @media (max-width: 900px) {
          div[style*="grid-template-columns: 1.1fr 0.9fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}