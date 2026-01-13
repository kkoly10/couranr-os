"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  status: string;
  purpose: string;
  verification_status: string;
  agreement_signed: boolean;
  paid: boolean;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
  lockbox_code_released_at: string | null;
  deposit_refund_status: string;
  created_at: string;
};

export default function AdminAutoDashboard() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);

    const { data, error } = await supabase
      .from("rentals")
      .select(`
        id,
        status,
        purpose,
        verification_status,
        agreement_signed,
        paid,
        pickup_confirmed_at,
        return_confirmed_at,
        lockbox_code_released_at,
        deposit_refund_status,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (!error) setRentals(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <p style={{ padding: 24 }}>Loading auto rentals…</p>;
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28 }}>Admin — Auto Rentals</h1>
      <p style={{ color: "#555", marginTop: 6 }}>
        Manage verification, pickup, returns, and deposit lifecycle.
      </p>

      {rentals.length === 0 && (
        <p style={{ marginTop: 20 }}>No rentals found.</p>
      )}

      {rentals.map((r) => (
        <div
          key={r.id}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 16,
            marginTop: 14,
            background: "#fff",
          }}
        >
          <strong>Rental ID:</strong> {r.id}
          <br />

          <strong>Purpose:</strong> {r.purpose}
          <br />

          <strong>Verification:</strong>{" "}
          <StatusBadge value={r.verification_status} />
          <br />

          <strong>Agreement signed:</strong>{" "}
          {r.agreement_signed ? "Yes" : "No"}
          <br />

          <strong>Paid:</strong> {r.paid ? "Yes" : "No"}
          <br />

          <strong>Lockbox released:</strong>{" "}
          {r.lockbox_code_released_at ? "Yes" : "No"}
          <br />

          <strong>Pickup confirmed:</strong>{" "}
          {r.pickup_confirmed_at ? "Yes" : "No"}
          <br />

          <strong>Return confirmed:</strong>{" "}
          {r.return_confirmed_at ? "Yes" : "No"}
          <br />

          <strong>Deposit status:</strong>{" "}
          <StatusBadge value={r.deposit_refund_status} />

          <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
            Created: {new Date(r.created_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const color =
    value === "approved" || value === "refunded"
      ? "#16a34a"
      : value === "pending"
      ? "#ca8a04"
      : value === "denied" || value === "withheld"
      ? "#dc2626"
      : "#374151";

  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: "#f3f4f6",
        color,
      }}
    >
      {value}
    </span>
  );
}