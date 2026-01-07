"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* ---------------- Types ---------------- */

type QuoteResult = {
  amountCents: number;
  breakdown: {
    base: number;
    extraMiles: number;
    weightSurcharge: number;
    stops: number;
    rush: number;
    signature: number;
    total: number;
  };
  flags: {
    longDistance: boolean;
    heavyItem: boolean;
  };
};

type DistanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; miles: number; text: string }
  | { status: "error"; message: string };

/* ---------------- Helpers ---------------- */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function isAfterCutoff() {
  const now = new Date();
  const h = now.getHours();
  return h >= 16; // 4:00 PM cutoff
}

/* ---------------- Component ---------------- */

export default function QuoteClient() {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;

  const pickupRef = useRef<HTMLInputElement | null>(null);
  const dropoffRef = useRef<HTMLInputElement | null>(null);

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [weight, setWeight] = useState<number | "">("");
  const [rush, setRush] = useState(false);
  const [signature, setSignature] = useState(false);

  const [distance, setDistance] = useState<DistanceState>({ status: "idle" });
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ---------------- Google Maps ---------------- */

  useEffect(() => {
    if ((window as any).google?.maps?.places) return;

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, [apiKey]);

  /* ---------------- Distance + Quote ---------------- */

  useEffect(() => {
    if (pickup.length < 6 || dropoff.length < 6 || weight === "") return;

    setDistance({ status: "loading" });
    setQuote(null);
    setError(null);

    const g = (window as any).google;
    if (!g?.maps) return;

    new g.maps.DistanceMatrixService().getDistanceMatrix(
      {
        origins: [pickup],
        destinations: [dropoff],
        travelMode: g.maps.TravelMode.DRIVING,
        unitSystem: g.maps.UnitSystem.IMPERIAL,
      },
      async (res: any, status: string) => {
        if (status !== "OK") {
          setDistance({ status: "error", message: "Distance unavailable" });
          return;
        }

        const el = res.rows?.[0]?.elements?.[0];
        if (!el || el.status !== "OK") {
          setDistance({ status: "error", message: "Invalid addresses" });
          return;
        }

        const miles = round2(el.distance.value / 1609.344);
        setDistance({ status: "ok", miles, text: el.distance.text });

        try {
          const q = await fetch("/api/delivery/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              miles,
              weightLbs: Number(weight),
              stops: 0,
              rush,
              signature,
            }),
          }).then((r) => r.json());

          if (q.error) throw new Error(q.error);
          setQuote(q);
        } catch (e: any) {
          setError(e.message || "Failed to generate quote");
        }
      }
    );
  }, [pickup, dropoff, weight, rush, signature]);

  /* ---------------- Checkout ---------------- */

  const goToCheckout = () => {
    if (!quote || distance.status !== "ok") return;

    const qs = new URLSearchParams({
      price: (quote.amountCents / 100).toFixed(2),
      miles: String(distance.miles),
      pickup,
      dropoff,
      weight: String(weight),
      rush: rush ? "1" : "0",
      signature: signature ? "1" : "0",
    });

    router.push(`/courier/checkout?${qs.toString()}`);
  };

  /* ---------------- UI ---------------- */

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 34 }}>Courier Delivery Quote</h1>

      {isAfterCutoff() && (
        <div style={banner}>
          Orders placed after <strong>4:00 PM</strong> will be scheduled for the
          next business day.
        </div>
      )}

      <div style={card}>
        <input ref={pickupRef} placeholder="Pickup address" onChange={(e) => setPickup(e.target.value)} />
        <input ref={dropoffRef} placeholder="Drop-off address" onChange={(e) => setDropoff(e.target.value)} />
        <input
          type="number"
          placeholder="Weight (lbs)"
          value={weight}
          onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))}
        />

        <label><input type="checkbox" checked={rush} onChange={() => setRush(!rush)} /> Rush</label>
        <label><input type="checkbox" checked={signature} onChange={() => setSignature(!signature)} /> Signature</label>
      </div>

      {distance.status === "loading" && <p>Calculating distance…</p>}
      {distance.status === "ok" && <p>{distance.text}</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {quote && (
        <div style={card}>
          <h2>${quote.breakdown.total.toFixed(2)}</h2>

          <details>
            <summary>View price breakdown</summary>
            <ul>
              <li>Base: ${quote.breakdown.base}</li>
              <li>Extra miles: ${quote.breakdown.extraMiles}</li>
              <li>Weight surcharge: ${quote.breakdown.weightSurcharge}</li>
              {quote.breakdown.rush > 0 && <li>Rush: ${quote.breakdown.rush}</li>}
              {quote.breakdown.signature > 0 && <li>Signature: ${quote.breakdown.signature}</li>}
            </ul>
          </details>

          {quote.flags.longDistance && <p>⚠ Long-distance delivery</p>}
          {quote.flags.heavyItem && <p>⚠ Heavy-item handling required</p>}

          <p style={{ fontSize: 12, color: "#555" }}>
            Drivers may refuse pickup if the item exceeds declared weight,
            appears unsafe, or requires more than one person to lift.
          </p>

          <button onClick={goToCheckout}>Continue to checkout</button>
        </div>
      )}
    </main>
  );
}

/* ---------------- Styles ---------------- */

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 16,
  marginTop: 20,
};

const banner: React.CSSProperties = {
  background: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: 12,
  padding: 12,
  marginBottom: 16,
};