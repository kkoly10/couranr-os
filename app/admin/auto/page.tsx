// app/admin/auto/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  status: string;
  purpose: string;
  paid: boolean;
  return_confirmed_at: string | null;
  deposit_refund_status: string;
  deposit_refund_amount_cents: number;
  damage_confirmed: boolean;
  damage_confirmed_at: string | null;
  damage_notes: string | null;
  created_at: string;
};

export default function AdminAutoDepositsPage() {
  const [loading, setLoading] = useState(true);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function getToken() {
    const { data: sessionRes } = await supabase.auth.getSession();
    return sessionRes.session?.access_token || null;
  }

  async function load() {
    setLoading(true);
    setError(null);

    const token = await getToken();
    if (!token) {
      setError("Not logged in.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        status,
        purpose,
        paid,
        return_confirmed_at,
        deposit_refund_status,
        deposit_refund_amount_cents,
        damage_confirmed,
        damage_confirmed_at,
        damage_notes,
        created_at
      `
      )
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    setRentals((data as any) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function confirmDamage(rentalId: string, damageConfirmed: boolean) {
    setError(null);

    const token = await getToken();
    if (!token) {
      setError("Unauthorized.");
      return;
    }

    const notes =
      damageConfirmed
        ? prompt("Damage notes (optional)", "Damage / cleaning / mileage") || null
        : null;

    setBusyId(rentalId);

    try {
      const res = await fetch("/api/admin/auto/confirm-damage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rentalId,
          damageConfirmed,
          notes,
        }),
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed damage update");

      await load();
    } catch (e: any) {
      setError(e?.message || "Server error");
    } finally {
      setBusyId(null);
    }
  }

  async function refundDeposit(rentalId: string) {
    setError(null);

    const token = await getToken();
    if (!token) {
      setError("Unauthorized.");
      return;
    }

    if (!window.confirm("Refund the deposit now? This will attempt a Stripe refund.")) {
      return;
    }

    setBusyId(rentalId);

    try {
      const res = await fetch("/api/admin/auto/refund-deposit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rentalId }),
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to refund deposit");

      await load();
      alert(data?.note || "Deposit refunded.");
    } catch (e: any) {
      setError(e?.message || "Server error");
    } finally {
      setBusyId(null);
    }
  }

  async function depositDecision(rentalId: string, decision: "withheld") {
    setError(null);

    const token = await getToken();
    if (!token) {
      setError("Unauthorized.");
      return;
    }

    let amountCents = 0;
    let reason: string | null = null;

    const amt = prompt("Amount to withhold (in dollars). Example: 75.00", "0");
    if (amt === null) return;

    const num = Number(amt);
    if (!Number.isFinite(num) || num < 0) {
      alert("Invalid amount.");
      return;
    }
    amountCents = Math.round(num * 100);

    reason = prompt("Reason for withholding", "Damage / cleaning / mileage") || null;

    setBusyId(rentalId);

    try {
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
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed deposit decision");

      await load();
      alert("Saved.");
    } catch (e: any) {
      setError(e?.message || "Server error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Admin — Auto Deposits</h1>
          <p style={{ color: "#555", marginTop: 6 }}>
            Confirm damage first (if any). Then refund or withhold deposit.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/auto" style={btnGhost}>Back to Auto Admin</Link>
          <button onClick={load} style={btnPrimary}>Refresh</button>
        </div>
      </div>

      {loading && <p style={{ paddingTop: 16 }}>Loading…</p>}

      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #fecaca" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
        </div>
      )}

      {!loading && rentals.length === 0 && <p style={{ marginTop: 18 }}>No rentals found.</p>}

      {!loading &&
        rentals.map((r) => {
          const canDecide = !!r.return_confirmed_at && !!r.paid;
          const canWithhold = canDecide && !!r.damage_confirmed;
          const isFinal = r.deposit_refund_status === "refunded" || r.deposit_refund_status === "withheld";

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
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ lineHeight: 1.65 }}>
                  <div><strong>Rental ID:</strong> {r.id}</div>
                  <div><strong>Purpose:</strong> {r.purpose}</div>
                  <div><strong>Paid:</strong> {r.paid ? "Yes" : "No"}</div>
                  <div><strong>Return confirmed:</strong> {r.return_confirmed_at ? "Yes" : "No"}</div>

                  <div style={{ marginTop: 6 }}>
                    <strong>Damage status:</strong>{" "}
                    <Badge value={r.damage_confirmed ? "confirmed" : "not_confirmed"} />
                    {r.damage_confirmed_at && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: "#6b7280" }}>
                        ({new Date(r.damage_confirmed_at).toLocaleString()})
                      </span>
                    )}
                  </div>

                  {r.damage_notes && (
                    <div style={{ marginTop: 6, fontSize: 13, color: "#374151" }}>
                      <strong>Damage notes:</strong> {r.damage_notes}
                    </div>
                  )}

                  <div style={{ marginTop: 10 }}>
                    <strong>Deposit status:</strong>{" "}
                    <Badge value={r.deposit_refund_status} />
                    {r.deposit_refund_status === "withheld" && (
                      <span style={{ marginLeft: 8, color: "#111" }}>
                        (${(Number(r.deposit_refund_amount_cents || 0) / 100).toFixed(2)} withheld)
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
                    Created: {new Date(r.created_at).toLocaleString()}
                  </div>

                  {!isFinal && r.return_confirmed_at && r.damage_confirmed && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #fde68a",
                        background: "#fffbeb",
                        color: "#92400e",
                      }}
                    >
                      <strong>Damage under review:</strong> deposit decision pending.
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", maxWidth: 520 }}>
                  <button
                    disabled={!canDecide || isFinal || busyId === r.id}
                    onClick={() => confirmDamage(r.id, true)}
                    style={{
                      ...btnWarn,
                      opacity: !canDecide || isFinal || busyId === r.id ? 0.6 : 1,
                      cursor: !canDecide || isFinal || busyId === r.id ? "not-allowed" : "pointer",
                    }}
                  >
                    Confirm Damage
                  </button>

                  <button
                    disabled={!canDecide || isFinal || busyId === r.id}
                    onClick={() => confirmDamage(r.id, false)}
                    style={{
                      ...btnGhostBtn,
                      opacity: !canDecide || isFinal || busyId === r.id ? 0.6 : 1,
                      cursor: !canDecide || isFinal || busyId === r.id ? "not-allowed" : "pointer",
                    }}
                  >
                    Clear Damage
                  </button>

                  <button
                    disabled={!canDecide || isFinal || busyId === r.id}
                    onClick={() => refundDeposit(r.id)}
                    style={{
                      ...btnPrimary,
                      opacity: !canDecide || isFinal || busyId === r.id ? 0.6 : 1,
                      cursor: !canDecide || isFinal || busyId === r.id ? "not-allowed" : "pointer",
                    }}
                  >
                    Refund Deposit
                  </button>

                  <button
                    disabled={!canWithhold || isFinal || busyId === r.id}
                    onClick={() => depositDecision(r.id, "withheld")}
                    style={{
                      ...btnDanger,
                      opacity: !canWithhold || isFinal || busyId === r.id ? 0.6 : 1,
                      cursor: !canWithhold || isFinal || busyId === r.id ? "not-allowed" : "pointer",
                    }}
                  >
                    Withhold Deposit
                  </button>

                  <div style={{ fontSize: 12, color: "#6b7280", maxWidth: 260 }}>
                    Withhold requires: paid + return confirmed + <strong>damage confirmed</strong>.
                  </div>
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const color =
    value === "refunded" || value === "approved" || value === "confirmed"
      ? "#16a34a"
      : value === "withheld"
      ? "#dc2626"
      : value === "pending"
      ? "#ca8a04"
      : "#374151";

  return (
    <span
      style={{
        padding: "2px 10px",
        borderRadius: 999,
        background: "#f3f4f6",
        color,
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {value}
    </span>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
};

const btnDanger: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#dc2626",
  color: "#fff",
  fontWeight: 900,
};

const btnWarn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#f59e0b",
  color: "#111",
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
  display: "inline-block",
};

const btnGhostBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
};