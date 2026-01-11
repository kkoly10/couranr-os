"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function RentClient({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    licenseNumber: "",
    licenseState: "",
    days: 1,
    pickupAt: "",
    purpose: "personal",
    signature: "",
  });

  function update<K extends keyof typeof form>(key: K, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);

    const sessionRes = await supabase.auth.getSession();
    const token = sessionRes.data.session?.access_token;

    if (!token) {
      setError("You must be logged in to continue.");
      router.push("/login");
      return;
    }

    const {
      fullName,
      phone,
      licenseNumber,
      licenseState,
      pickupAt,
      signature,
    } = form;

    if (
      !fullName ||
      !phone ||
      !licenseNumber ||
      !licenseState ||
      !pickupAt ||
      !signature
    ) {
      setError("Please complete all required fields.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auto/create-rental", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehicleId,
          ...form,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create rental");
      }

      router.push(`/auto/checkout?rentalId=${data.rentalId}`);
    } catch (e: any) {
      setError(e.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}>
      <h2>Reserve this vehicle</h2>

      <div style={{ display: "grid", gap: 14 }}>
        <input placeholder="Full name" onChange={(e) => update("fullName", e.target.value)} />
        <input placeholder="Phone" onChange={(e) => update("phone", e.target.value)} />
        <input placeholder="License number" onChange={(e) => update("licenseNumber", e.target.value)} />

        <select onChange={(e) => update("licenseState", e.target.value)}>
          <option value="">License state</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select onChange={(e) => update("purpose", e.target.value)}>
          <option value="personal">Personal / Leisure</option>
          <option value="rideshare">Rideshare (Uber / Lyft)</option>
        </select>

        <input type="datetime-local" onChange={(e) => update("pickupAt", e.target.value)} />
        <input type="number" min={1} value={form.days} onChange={(e) => update("days", Number(e.target.value))} />
        <input placeholder="Type your name as signature" onChange={(e) => update("signature", e.target.value)} />

        {error && <div style={{ color: "red" }}>{error}</div>}

        <button onClick={submit} disabled={loading}>
          {loading ? "Processing…" : "Continue to payment"}
        </button>
      </div>
    </div>
  );
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
];