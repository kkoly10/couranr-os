"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function RentalAgreementPage() {
  const router = useRouter();
  const params = useParams();
  const vehicleId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [rentalId, setRentalId] = useState<string | null>(null);
  const [signedName, setSignedName] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?next=/auto/rent/${vehicleId}/agreement`);
        return;
      }

      // Find latest draft rental for this vehicle + user
      const { data: rental, error } = await supabase
        .from("rentals")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .eq("user_id", data.session.user.id)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error || !rental) {
        setError("Rental not found. Please restart booking.");
        setLoading(false);
        return;
      }

      setRentalId(rental.id);
      setLoading(false);
    }

    load();
  }, [router, vehicleId]);

  async function submitAgreement() {
    setError(null);

    if (!signedName.trim()) {
      setError("Please type your full legal name.");
      return;
    }
    if (!agree) {
      setError("You must agree to the rental terms.");
      return;
    }
    if (!rentalId) {
      setError("Missing rental record.");
      return;
    }

    const res = await fetch("/api/auto/sign-agreement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rentalId,
        signedName,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Failed to sign agreement.");
      return;
    }

    router.push(`/auto/rent/${vehicleId}/checkout`);
  }

  if (loading) return <p style={{ padding: 24 }}>Loading agreement…</p>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>Rental Agreement</h1>

      <div style={box}>
        <p>
          This vehicle rental agreement is between <strong>Couranr Auto Rentals</strong>{" "}
          and the renter listed below.
        </p>

        <ul style={{ lineHeight: 1.7 }}>
          <li>Same-day rentals are charged daily</li>
          <li>Weekly rate applies at 7 days</li>
          <li>Pickup & return: 1090 Stafford Marketplace, VA 22556</li>
          <li>Business hours: 9:00 AM – 6:00 PM</li>
          <li>Vehicle must be returned in same condition</li>
          <li>Deposit is refunded after inspection</li>
        </ul>

        <p style={{ marginTop: 14 }}>
          By signing below, you acknowledge and agree to all rental terms.
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <label><strong>Type your full legal name</strong></label>
        <input
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          placeholder="Full name"
          style={input}
        />
      </div>

      <label style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <input
          type="checkbox"
          checked={agree}
          onChange={() => setAgree(!agree)}
        />
        <span>I agree to the rental terms above</span>
      </label>

      {error && <p style={{ color: "red", marginTop: 12 }}>{error}</p>}

      <button onClick={submitAgreement} style={primaryBtn}>
        Continue to payment
      </button>
    </div>
  );
}

const box = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
};

const input = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  marginTop: 6,
};

const primaryBtn = {
  marginTop: 18,
  padding: "12px 16px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};