"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* ----------------------------- types ----------------------------- */

type Vehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  color?: string;
  daily_rate_cents: number;
  weekly_rate_cents: number;
  deposit_cents: number;
  image_urls?: string[];
};

/* --------------------------- helpers ----------------------------- */

const LOCATION = "1090 Stafford Marketplace, Stafford, VA 22556";
const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;

// Round to next :00 or :30
function roundToNextSlot(d: Date) {
  const minutes = d.getMinutes();
  if (minutes < 30) {
    d.setMinutes(30, 0, 0);
  } else {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0, 0, 0);
  }
  return d;
}

// Earliest pickup logic (locked)
function computeEarliestPickup() {
  const now = new Date();
  let base = new Date(now.getTime() + 50 * 60 * 1000); // +50 min

  if (base.getHours() < OPEN_HOUR) {
    base.setHours(OPEN_HOUR, 0, 0, 0);
  }

  if (base.getHours() >= CLOSE_HOUR) {
    base.setDate(base.getDate() + 1);
    base.setHours(OPEN_HOUR, 0, 0, 0);
  }

  return roundToNextSlot(base);
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/* --------------------------- component --------------------------- */

export default function RentClient({ vehicle }: { vehicle: Vehicle }) {
  const router = useRouter();

  /* renter info */
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [license, setLicense] = useState("");

  /* rental options */
  const [days, setDays] = useState(1);
  const [pickupAt, setPickupAt] = useState(() => computeEarliestPickup());
  const [signature, setSignature] = useState("");

  const isWeekly = days >= 7;

  const rateCents = isWeekly
    ? vehicle.weekly_rate_cents
    : vehicle.daily_rate_cents * days;

  const totalCents = rateCents + vehicle.deposit_cents;

  const canSubmit =
    fullName &&
    phone &&
    license &&
    signature &&
    pickupAt instanceof Date;

  async function submitReservation() {
    if (!canSubmit) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    const res = await fetch("/api/auto/create-rental", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        vehicleId: vehicle.id,
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
      alert(data.error || "Failed to create rental");
      return;
    }

    router.push(`/auto/checkout?rentalId=${data.rentalId}`);
  }

  /* --------------------------- UI --------------------------- */

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>
        Rent {vehicle.year} {vehicle.make} {vehicle.model}
      </h1>

      {vehicle.image_urls?.[0] && (
        <img
          src={vehicle.image_urls[0]}
          alt="Vehicle"
          style={{ width: "100%", borderRadius: 12, marginBottom: 16 }}
        />
      )}

      <p><strong>Pickup & Return:</strong> {LOCATION}</p>
      <p><strong>Hours:</strong> 9:00 AM – 6:00 PM</p>

      <hr />

      <h3>Renter Information</h3>

      <input
        placeholder="Full legal name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        style={input}
      />

      <input
        placeholder="Phone number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={input}
      />

      <input
        placeholder="Driver license number"
        value={license}
        onChange={(e) => setLicense(e.target.value)}
        style={input}
      />

      <h3>Rental Details</h3>

      <label>Number of days</label>
      <input
        type="number"
        min={1}
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        style={input}
      />

      <label>Pickup time</label>
      <input
        type="datetime-local"
        value={pickupAt.toISOString().slice(0, 16)}
        onChange={(e) => setPickupAt(new Date(e.target.value))}
        style={input}
      />

      <h3>Pricing</h3>

      <p>
        {isWeekly ? "Weekly rate:" : "Daily rate:"}{" "}
        {money(isWeekly ? vehicle.weekly_rate_cents : vehicle.daily_rate_cents)}
      </p>

      {vehicle.deposit_cents > 0 && (
        <p>Deposit: {money(vehicle.deposit_cents)}</p>
      )}

      <p><strong>Total due today: {money(totalCents)}</strong></p>

      <h3>Agreement & Signature</h3>

      <textarea
        placeholder="Type your full name as signature"
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
        style={{ ...input, height: 80 }}
      />

      <button
        disabled={!canSubmit}
        onClick={submitReservation}
        style={{
          marginTop: 16,
          padding: "14px 18px",
          borderRadius: 10,
          border: "none",
          background: canSubmit ? "#111827" : "#9ca3af",
          color: "#fff",
          fontWeight: 800,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        Continue to payment
      </button>
    </div>
  );
}

/* --------------------------- styles --------------------------- */

const input: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  marginBottom: 12,
};