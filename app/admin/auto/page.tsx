"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  purpose: string;
  verification_status: string;
  agreement_signed: boolean;
  paid: boolean;
  lockbox_code_released_at: string | null;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
  damage_confirmed: boolean;
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
        purpose,
        verification_status,
        agreement_signed,
        paid,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at,
        damage_confirmed,
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

  async function confirmDamage(rentalId: string) {
    const notes = prompt("Describe the damage (required):");
    if (!notes) return;

    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return alert("Unauthorized");

    const res = await fetch("/api/admin/auto/confirm-damage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ rentalId, notes }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error || "Failed to confirm damage");
      return;
    }

    alert("Damage confirmed");
    load();
  }

  if (loading) {
    return <p style={{ padding: 24 }}>Loading auto rentals…</p>;
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Admin — Auto Rentals</h1>
          <p style={{ color: "#555", marginTop: 6 }}>
            Full rental lifecycle overview.
          </p>
        </div>

        <Link href="/admin/auto/deposits" style={btnGhost}>
          Deposit Decisions →
        </Link>
      </div>

      {rentals.length === 0 && <p>No rentals found.</p>}

      {rentals.map((r) => (
        <div
          key={r.id}
          style={{
            marginTop: 16,
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 16,
            background: "#fff",
          }}
        >
          <div style={{ lineHeight: 1.7 }}>
            <div><strong>ID:</strong> {r.id}</div>
            <div><strong>Purpose:</strong> {r.purpose}</div>
            <div><strong>Verification:</strong> {r.verification_status}</div>
            <div><strong>Agreement:</strong> {r.agreement_signed ? "Yes" : "No"}</div>
            <div><strong>Paid:</strong> {r.paid ? "Yes" : "No"}</div>
            <div><strong>Lockbox released:</strong> {r.lockbox_code_released_at ? "Yes" : "No"}</div>
            <div><strong>Pickup confirmed:</strong> {r.pickup_confirmed_at ? "Yes" : "No"}</div>
            <div><strong>Return confirmed:</strong> {r.return_confirmed_at ? "Yes" : "No"}</div>
            <div><strong>Damage confirmed:</strong> {r.damage_confirmed ? "Yes" : "No"}</div>
            <div><strong>Deposit status:</strong> {r.deposit_refund_status}</div>
          </div>

          {/* 🔴 DAMAGE CONFIRMATION BUTTON (GATED) */}
          {r.return_confirmed_at && !r.damage_confirmed && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => confirmDamage(r.id)}
                style={btnDanger}
              >
                Confirm Damage
              </button>
            </div>
          )}

          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
            Created: {new Date(r.created_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

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
