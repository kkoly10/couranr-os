"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function RentClient({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [license, setLicense] = useState("");
  const [days, setDays] = useState(1);
  const [pickupAt, setPickupAt] = useState("");
  const [signature, setSignature] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinueToPayment() {
    setError(null);
    setLoading(true);

    try {
      // 1️⃣ Ensure user is authenticated
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push(
          `/login?next=${encodeURIComponent(window.location.pathname)}`
        );
        return;
      }

      // 2️⃣ Create rental + Stripe session
      const res = await fetch("/api/auto/create-rental", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          vehicleId,
          fullName,
          phone,
          license,
          days,
          pickupAt,
          signature,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create rental");
      }

      if (!data.checkoutUrl) {
        throw new Error("Missing Stripe checkout URL");
      }

      // ✅ 3️⃣ Redirect to Stripe (THIS WAS THE MISSING PIECE)
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>Rent this vehicle</h1>

      <label>Full name</label>
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} />

      <label>Phone</label>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} />

      <label>Driver’s license number</label>
      <input value={license} onChange={(e) => setLicense(e.target.value)} />

      <label>Rental duration (days)</label>
      <input
        type="number"
        min={1}
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
      />

      <label>Pickup date & time</label>
      <input
        type="datetime-local"
        value={pickupAt}
        onChange={(e) => setPickupAt(e.target.value)}
      />

      <label>Signature (type your full name)</label>
      <input
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
      />

      {error && (
        <div style={{ color: "red", marginTop: 12 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleContinueToPayment}
        disabled={loading}
        style={{
          marginTop: 20,
          padding: "12px 16px",
          background: "#111827",
          color: "#fff",
          borderRadius: 10,
          fontWeight: 700,
        }}
      >
        {loading ? "Redirecting…" : "Continue to payment"}
      </button>
    </div>
  );
}