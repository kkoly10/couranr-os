"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  status: string | null;
  purpose: string | null;
  verification_status: string;
  agreement_signed: boolean;
  paid: boolean;
  lockbox_code_released_at: string | null;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
  condition_photos_status: string;
  deposit_refund_status: string;
  deposit_refund_amount_cents: number;
  damage_confirmed: boolean;
  created_at: string;
};

export default function AdminAutoDashboard() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        status,
        purpose,
        verification_status,
        agreement_signed,
        paid,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at,
        condition_photos_status,
        deposit_refund_status,
        deposit_refund_amount_cents,
        damage_confirmed,
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

  async function downloadEvidenceBundle(rentalId: string) {
    setError(null);
    setBusyId(rentalId);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("Unauthorized");

      const res = await fetch("/api/admin/auto/evidence-bundle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rentalId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to generate bundle");
      }

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `evidence_${rentalId}.zip`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "Server error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading auto rentals…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Admin — Auto Rentals</h1>
          <p style={{ color: "#555", marginTop: 6 }}>
            Manage verification, pickup, returns, deposits, and evidence bundles.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/auto/deposits" style={btnGhost}>Deposits</Link>
          <button onClick={load} style={btnPrimary}>Refresh</button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #fecaca" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
        </div>
      )}

      {rentals.length === 0 && <p style={{ marginTop: 18 }}>No rentals found.</p>}

      {rentals.map((r) => {
        const canDownloadBundle = !!r.return_confirmed_at;
        return (
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
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ lineHeight: 1.65 }}>
                <div><strong>Rental ID:</strong> {r.id}</div>
                <div><strong>Status:</strong> {r.status || "—"}</div>
                <div><strong>Purpose:</strong> {r.purpose || "—"}</div>
                <div>
                  <strong>Verification:</strong> <Badge value={r.verification_status} />
                </div>
                <div><strong>Agreement signed:</strong> {r.agreement_signed ? "Yes" : "No"}</div>
                <div><strong>Paid:</strong> {r.paid ? "Yes" : "No"}</div>
                <div><strong>Lockbox released:</strong> {r.lockbox_code_released_at ? "Yes" : "No"}</div>
                <div><strong>Pickup confirmed:</strong> {r.pickup_confirmed_at ? "Yes" : "No"}</div>
                <div><strong>Return confirmed:</strong> {r.return_confirmed_at ? "Yes" : "No"}</div>
                <div>
                  <strong>Condition photos status:</strong> <Badge value={r.condition_photos_status} />
                </div>
                <div>
                  <strong>Damage confirmed:</strong>{" "}
                  <Badge value={r.damage_confirmed ? "yes" : "no"} />
                </div>
                <div>
                  <strong>Deposit status:</strong>{" "}
                  <Badge value={r.deposit_refund_status} />{" "}
                  {r.deposit_refund_status === "withheld" && (
                    <span style={{ color: "#111" }}>
                      (${(Number(r.deposit_refund_amount_cents || 0) / 100).toFixed(2)} withheld)
                    </span>
                  )}
                </div>

                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  Created: {new Date(r.created_at).toLocaleString()}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <button
                  disabled={!canDownloadBundle || busyId === r.id}
                  onClick={() => downloadEvidenceBundle(r.id)}
                  style={{
                    ...btnPrimary,
                    opacity: !canDownloadBundle || busyId === r.id ? 0.6 : 1,
                    cursor: !canDownloadBundle || busyId === r.id ? "not-allowed" : "pointer",
                  }}
                >
                  {busyId === r.id ? "Preparing…" : "Download Evidence Bundle"}
                </button>

                {!canDownloadBundle && (
                  <div style={{ fontSize: 12, color: "#6b7280", maxWidth: 240 }}>
                    Available after return confirmation.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const v = String(value || "").toLowerCase();
  const color =
    v === "approved" || v === "refunded" || v === "complete" || v === "yes"
      ? "#16a34a"
      : v === "pending"
      ? "#ca8a04"
      : v === "denied" || v === "withheld" || v === "no"
      ? "#dc2626"
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