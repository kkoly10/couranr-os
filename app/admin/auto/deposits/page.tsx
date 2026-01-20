"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  purpose: string;
  paid: boolean;
  return_confirmed_at: string | null;
  damage_confirmed: boolean;
  deposit_refund_status: string;
  deposit_refund_amount_cents: number;
  created_at: string;
};

export default function AdminAutoDepositsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);

    const { data, error } = await supabase
      .from("rentals")
      .select(`
        id,
        purpose,
        paid,
        return_confirmed_at,
        damage_confirmed,
        deposit_refund_status,
        deposit_refund_amount_cents,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (!error) setRentals(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(
    rentalId: string,
    decision: "refunded" | "withheld"
  ) {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return alert("Unauthorized");

    let amountCents = 0;
    let reason: string | null = null;

    if (decision === "withheld") {
      const amt = prompt("Amount to withhold (USD)", "0");
      if (amt === null) return;
      amountCents = Math.round(Number(amt) * 100);
      if (!Number.isFinite(amountCents) || amountCents < 0) {
        alert("Invalid amount");
        return;
      }
      reason = prompt("Reason for withholding") || null;
    }

    setBusyId(rentalId);

    const res = await fetch("/api/admin/auto/deposit-decision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rentalId,
        decision,
        amountCents,
        reason,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error || "Failed");
    }

    setBusyId(null);
    load();
  }

  if (loading) return <p style={{ padding: 24 }}>Loading deposits…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 28 }}>Admin — Deposit Decisions</h1>
        <Link href="/admin/auto" style={btnGhost}>← Back</Link>
      </div>

      {rentals.map((r) => {
        const canRefund = r.paid && r.return_confirmed_at;
        const canWithhold = canRefund && r.damage_confirmed;

        return (
          <div
            key={r.id}
            style={{
              marginTop: 14,
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              background: "#fff",
            }}
          >
            <div><strong>ID:</strong> {r.id}</div>
            <div><strong>Paid:</strong> {r.paid ? "Yes" : "No"}</div>
            <div><strong>Return confirmed:</strong> {r.return_confirmed_at ? "Yes" : "No"}</div>
            <div><strong>Damage confirmed:</strong> {r.damage_confirmed ? "Yes" : "No"}</div>
            <div><strong>Status:</strong> {r.deposit_refund_status}</div>

            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <button
                disabled={!canRefund || busyId === r.id}
                onClick={() => decide(r.id, "refunded")}
                style={{ ...btnPrimary, opacity: canRefund ? 1 : 0.5 }}
              >
                Refund
              </button>

              <button
                disabled={!canWithhold || busyId === r.id}
                onClick={() => decide(r.id, "withheld")}
                style={{ ...btnDanger, opacity: canWithhold ? 1 : 0.5 }}
              >
                Withhold
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "#111827",
  color: "#fff",
  border: "none",
  fontWeight: 900,
};

const btnDanger: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "#dc2626",
  color: "#fff",
  border: "none",
  fontWeight: 900,
};

const btnGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  textDecoration: "none",
};
