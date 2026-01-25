"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  paid: boolean;
  return_confirmed_at: string | null;
  damage_confirmed: boolean;
  damage_notes: string | null;
  deposit_refund_status: string;
  deposit_refund_amount_cents: number;
};

export default function AdminAutoDepositsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("rentals")
      .select(
        "id, paid, return_confirmed_at, damage_confirmed, damage_notes, deposit_refund_status, deposit_refund_amount_cents"
      )
      .order("created_at", { ascending: false });

    setRentals(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function confirmDamage(rentalId: string) {
    const notes = prompt("Describe the damage");
    if (!notes) return;

    setBusyId(rentalId);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return alert("Unauthorized");

    await fetch("/api/admin/auto/confirm-damage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ rentalId, notes }),
    });

    setBusyId(null);
    load();
  }

  async function decideDeposit(rentalId: string, decision: "refunded" | "withheld") {
    const amount =
      decision === "withheld"
        ? Number(prompt("Amount to withhold (USD)", "0")) * 100
        : 0;

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
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
      }),
    });

    load();
  }

  if (loading) return <p>Loading deposits…</p>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1>Admin — Auto Deposits</h1>

      {rentals.map((r) => {
        const canConfirmDamage = r.return_confirmed_at && !r.damage_confirmed;
        const canWithhold = r.damage_confirmed && r.paid;

        return (
          <div key={r.id} style={{ border: "1px solid #e5e7eb", padding: 16, marginTop: 12 }}>
            <div><strong>Rental:</strong> {r.id}</div>
            <div><strong>Returned:</strong> {r.return_confirmed_at ? "Yes" : "No"}</div>
            <div><strong>Damage confirmed:</strong> {r.damage_confirmed ? "Yes" : "No"}</div>

            {r.damage_notes && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <strong>Notes:</strong> {r.damage_notes}
              </div>
            )}

            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              {canConfirmDamage && (
                <button onClick={() => confirmDamage(r.id)} disabled={busyId === r.id}>
                  Confirm Damage
                </button>
              )}

              <button
                disabled={!canWithhold}
                onClick={() => decideDeposit(r.id, "withheld")}
              >
                Withhold Deposit
              </button>

              <button onClick={() => decideDeposit(r.id, "refunded")}>
                Refund Deposit
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}