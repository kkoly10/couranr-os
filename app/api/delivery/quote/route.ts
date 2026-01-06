"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function QuoteClient() {
  const router = useRouter();

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [weightLbs, setWeightLbs] = useState(20);
  const [stops, setStops] = useState(0);
  const [rush, setRush] = useState(false);
  const [signature, setSignature] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{
    miles: number;
    price: number;
  } | null>(null);

  async function getQuote() {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/delivery/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup,
          dropoff,
          weightLbs,
          stops,
          rush,
          signature,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to get quote");
      }

      setQuote({
        miles: data.miles,
        price: data.amountCents / 100,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function continueToCheckout() {
    if (!quote) return;

    const params = new URLSearchParams({
      price: quote.price.toString(),
      miles: quote.miles.toString(),
      weight: weightLbs.toString(),
      stops: stops.toString(),
      rush: rush ? "1" : "0",
      signature: signature ? "1" : "0",
      pickup,
      dropoff,
    });

    router.push(`/courier/checkout?${params.toString()}`);
  }

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>Get a delivery quote</h1>

      <input
        placeholder="Pickup address"
        value={pickup}
        onChange={(e) => setPickup(e.target.value)}
      />

      <input
        placeholder="Drop-off address"
        value={dropoff}
        onChange={(e) => setDropoff(e.target.value)}
      />

      <input
        type="number"
        value={weightLbs}
        onChange={(e) => setWeightLbs(Number(e.target.value))}
        placeholder="Weight (lbs)"
      />

      <button onClick={getQuote} disabled={loading}>
        {loading ? "Calculating…" : "Get quote"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {quote && (
        <div style={{ marginTop: 16 }}>
          <p>Miles: {quote.miles.toFixed(2)}</p>
          <p><strong>Total: ${quote.price.toFixed(2)}</strong></p>

          <button onClick={continueToCheckout}>
            Continue to checkout
          </button>
        </div>
      )}
    </div>
  );
}