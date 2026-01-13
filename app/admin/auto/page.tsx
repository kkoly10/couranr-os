"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  status: string;
  deposit_refund_status: string;
  deposit_refund_amount_cents: number;
  user_id: string;
};

export default function AdminAutoPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);

    const { data, error } = await supabase
      .from("rentals")
      .select("*")
      .eq("status", "returned")
      .order("return_confirmed_at", { ascending: false });

    if (!error) setRentals(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function decideDeposit(
    rentalId: string,
    decision: "refunded" | "withheld"
  ) {
    const amount =
      decision === "withheld"
        ? Number(prompt("Amount to withhold (cents)", "0"))
        : 0;

    const reason =
      decision === "withheld"
        ? prompt("Reason for withholding", "Damage / cleaning / mileage")
        : null;

    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return alert("Unauthorized");

    await fetch("/api/admin/auto/deposit-decision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rentalId,
        decision,
        amountCents: amount,
        reason,
      }),
    });

    load();
  }

  if (loading) return <p>Loading auto rentals…</p>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28 }}>Admin — Auto Rentals</h1>

      {rentals.length === 0 && <p>No returned rentals awaiting review.</p>}

      {rentals.map((r) => (
        <div
          key={r.id}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 16,
            marginTop: 12,
            background: "#fff",
          }}
        >
          <strong>Rental ID:</strong> {r.id}
          <br />
          <strong>Status:</strong> {r.status}
          <br />
          <strong>Deposit:</strong> {r.deposit_refund_status}
          <br />

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button
              onClick={() => decideDeposit(r.id, "refunded")}
              style={btnPrimary}
            >
              Refund Deposit
            </button>

            <button
              onClick={() => decideDeposit(r.id, "withheld")}
              style={btnDanger}
            >
              Withhold Deposit
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "#111827",
  color: "#fff",
  border: "none",
  fontWeight: 800,
};

const btnDanger: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "#dc2626",
  color: "#fff",
  border: "none",
  fontWeight: 800,
};