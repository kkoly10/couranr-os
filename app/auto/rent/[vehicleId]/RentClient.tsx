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
    pickupAt: "",
    days: 1,
    purpose: "personal",
    signature: "",
  });

  function update<K extends keyof typeof form>(key: K, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);

    const {
      fullName,
      phone,
      licenseNumber,
      pickupAt,
      days,
      purpose,
      signature,
    } = form;

    if (!fullName || !phone || !licenseNumber || !pickupAt || !signature) {
      setError("Missing required fields");
      return;
    }

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

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
          licenseNumber,
          pickupAt,
          days,
          purpose,
          signature,
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
    <div style={{ maxWidth: 820, margin: "40px auto", padding: 24 }}>
      <h2>Reserve this vehicle</h2>

      <input placeholder="Full name" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} />
      <input placeholder="Phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
      <input placeholder="Driver license #" value={form.licenseNumber} onChange={(e) => update("licenseNumber", e.target.value)} />

      <select value={form.purpose} onChange={(e) => update("purpose", e.target.value)}>
        <option value="personal">Personal / Leisure</option>
        <option value="rideshare">Rideshare (Uber / Lyft)</option>
      </select>

      <input type="datetime-local" value={form.pickupAt} onChange={(e) => update("pickupAt", e.target.value)} />
      <input type="number" min={1} value={form.days} onChange={(e) => update("days", Number(e.target.value))} />

      <input placeholder="Type name as signature" value={form.signature} onChange={(e) => update("signature", e.target.value)} />

      {error && <p style={{ color: "red" }}>{error}</p>}

      <button disabled={loading} onClick={submit}>
        {loading ? "Processing…" : "Continue to payment"}
      </button>
    </div>
  );
}