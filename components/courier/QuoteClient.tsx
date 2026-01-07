"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

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

  // Load autocomplete
  useEffect(() => {
    loadGoogleMaps(apiKey).then(() => {
      const g = (window as any).google;
      if (pickupRef.current) {
        new g.maps.places.Autocomplete(pickupRef.current, {
          fields: ["formatted_address"]
        }).addListener("place_changed", function () {
          setPickup(this.getPlace()?.formatted_address || "");
        });
      }
      if (dropoffRef.current) {
        new g.maps.places.Autocomplete(dropoffRef.current, {
          fields: ["formatted_address"]
        }).addListener("place_changed", function () {
          setDropoff(this.getPlace()?.formatted_address || "");
        });
      }
    });
  }, [apiKey]);

  const canCompute = useMemo(
    () => pickup.length > 5 && dropoff.length > 5,
    [pickup, dropoff]
  );

  // Distance
  useEffect(() => {
    if (!canCompute) return;

    setDistance({ status: "loading" });
    setQuote(null);
    setError(null);

    const g = (window as any).google;
    new g.maps.DistanceMatrixService().getDistanceMatrix(
      {
        origins: [pickup],
        destinations: [dropoff],
        travelMode: g.maps.TravelMode.DRIVING,
        unitSystem: g.maps.UnitSystem.IMPERIAL
      },
      async (res: any, status: string) => {
        if (status !== "OK") {
          setDistance({ status: "error", message: "Distance failed" });
          return;
        }

        const el = res.rows?.[0]?.elements?.[0];
        if (!el || el.status !== "OK") {
          setDistance({ status: "error", message: "Invalid addresses" });
          return;
        }

        const miles = round2(el.distance.value / 1609.344);
        setDistance({ status: "ok", miles, text: el.distance.text });

        // 🔑 SERVER QUOTE (single source of truth)
        try {
          const q = await fetch("/api/delivery/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              miles,
              weightLbs: Number(weight),
              stops: 0,
              rush,
              signature
            })
          }).then((r) => r.json());

          if (q.error) throw new Error(q.error);
          setQuote(q);
        } catch (e: any) {
          setError(e.message || "Failed to generate quote");
        }
      }
    );
  }, [canCompute, pickup, dropoff, weight, rush, signature]);

  const goCheckout = () => {
    if (!quote) return;
    router.push(
      `/courier/checkout?price=${(quote.amountCents / 100).toFixed(
        2
      )}&pickup=${encodeURIComponent(pickup)}&dropoff=${encodeURIComponent(
        dropoff
      )}&miles=${distance.status === "ok" ? distance.miles : 0}&weight=${weight}`
    );
  };

  return (
    <main style={{ padding: 80 }}>
      <h1>Courier Delivery Quote</h1>

      <input ref={pickupRef} placeholder="Pickup address" />
      <input ref={dropoffRef} placeholder="Drop-off address" />
      <input
        type="number"
        placeholder="Weight (lbs)"
        value={weight}
        onChange={(e) =>
          setWeight(e.target.value === "" ? "" : Number(e.target.value))
        }
      />

      <label>
        <input type="checkbox" checked={rush} onChange={() => setRush(!rush)} />{" "}
        Rush
      </label>
      <label>
        <input
          type="checkbox"
          checked={signature}
          onChange={() => setSignature(!signature)}
        />{" "}
        Signature
      </label>

      {distance.status === "loading" && <p>Calculating distance…</p>}
      {distance.status === "ok" && <p>{distance.text}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {quote && (
        <>
          <h2>${quote.breakdown.total.toFixed(2)}</h2>
          {quote.flags.longDistance && (
            <p>⚠ Long-distance delivery</p>
          )}
          {quote.flags.heavyItem && <p>⚠ Heavy item disclaimer applies</p>}
          <button onClick={goCheckout}>Continue to checkout</button>
        </>
      )}
    </main>
  );
}