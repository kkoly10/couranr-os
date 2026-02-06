"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  status: string | null;
  purpose: string | null;
  verification_status: string;
  verification_denial_reason?: string | null;
  docs_complete?: boolean;
  agreement_signed: boolean;
  paid: boolean;
  lockbox_code: string | null;
  lockbox_code_released_at: string | null;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
  condition_photos_status: string;
  deposit_refund_status: string;
  deposit_refund_amount_cents: number | null;
  damage_confirmed: boolean;
  created_at: string;
};

export default function AdminAutoDashboard() {
  const router = useRouter();

  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent("/admin/auto")}`);
      throw new Error("Unauthorized");
    }
    return token;
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      // If RLS blocks admin reads in prod, you can swap this to an admin API route.
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
          lockbox_code,
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

      if (error) throw new Error(error.message);
      setRentals((data as any) || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load rentals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function api(path: string, body: any) {
    const token = await getToken();

    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Request failed");
    return json;
  }

  async function approve(rentalId: string) {
    setBusyId(rentalId);
    setError(null);
    try {
      await api("/api/admin/auto/set-verification", { rentalId, status: "approved" });
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to approve");
    } finally {
      setBusyId(null);
    }
  }

  async function deny(rentalId: string) {
    const reason = prompt("Reason for denial? (required)");
    if (!reason?.trim()) return;

    setBusyId(rentalId);
    setError(null);
    try {
      await api("/api/admin/auto/set-verification", { rentalId, status: "denied", reason: reason.trim() });
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to deny");
    } finally {
      setBusyId(null);
    }
  }

  async function setLockbox(rentalId: string) {
    const code = prompt("Enter lockbox code (ex: 1234)");
    if (!code?.trim()) return;

    setBusyId(rentalId);
    setError(null);
    try {
      await api("/api/admin/auto/set-lockbox", { rentalId, code: code.trim() });
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to set lockbox");
    } finally {
      setBusyId(null);
    }
  }

  const stats = useMemo(() => {
    const total = rentals.length;
    const pendingVerif = rentals.filter((r) => String(r.verification_status).toLowerCase() === "pending").length;
    const approvedVerif = rentals.filter((r) => String(r.verification_status).toLowerCase() === "approved").length;
    const paid = rentals.filter((r) => !!r.paid).length;
    return { total, pendingVerif, approvedVerif, paid };
  }, [rentals]);

  if (loading) return <p style={{ padding: 24 }}>Loading auto rentals…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Admin — Auto Rentals</h1>
          <p style={{ color: "#555", marginTop: 6 }}>
            Manage verification, pickup, returns, deposits, and evidence bundles.
          </p>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip label={`Total: ${stats.total}`} />
            <Chip label={`Verif pending: ${stats.pendingVerif}`} />
            <Chip label={`Verif approved: ${stats.approvedVerif}`} />
            <Chip label={`Paid: ${stats.paid}`} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/auto/deposits" style={btnGhost}>
            Deposits
          </Link>
          <Link href="/admin/auto/rentals" style={btnGhost}>
            Rentals (detail list)
          </Link>
          <button onClick={load} style={btnPrimary}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
        </div>
      )}

      {rentals.length === 0 && <p style={{ marginTop: 18 }}>No rentals found.</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {rentals.map((r) => {
          const canAct = busyId === null || busyId === r.id;
          const isBusy = busyId === r.id;

          const canDownloadBundle = !!r.return_confirmed_at;

          return (
            <div
              key={r.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 16,
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ lineHeight: 1.65 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div>
                      <strong>Rental ID:</strong> {r.id}
                    </div>
                    <Badge value={r.status || "—"} />
                    <Badge value={r.purpose || "—"} />
                  </div>

                  <div>
                    <strong>Verification:</strong> <Badge value={r.verification_status} />
                  </div>
                  <div>
                    <strong>Agreement signed:</strong> {r.agreement_signed ? "Yes" : "No"}
                  </div>
                  <div>
                    <strong>Paid:</strong> {r.paid ? "Yes" : "No"}
                  </div>
                  <div>
                    <strong>Lockbox released:</strong> {r.lockbox_code_released_at ? "Yes" : "No"}
                  </div>
                  <div>
                    <strong>Pickup confirmed:</strong> {r.pickup_confirmed_at ? "Yes" : "No"}
                  </div>
                  <div>
                    <strong>Return confirmed:</strong> {r.return_confirmed_at ? "Yes" : "No"}
                  </div>
                  <div>
                    <strong>Condition photos status:</strong> <Badge value={r.condition_photos_status} />
                  </div>
                  <div>
                    <strong>Damage confirmed:</strong> <Badge value={r.damage_confirmed ? "yes" : "no"} />
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

                  {r.lockbox_code && (
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      Lockbox code: <strong>{r.lockbox_code}</strong>
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gap: 10, alignContent: "start", minWidth: 260 }}>
                  <Link href={`/admin/auto/rentals/${r.id}`} style={btnPrimaryLink}>
                    Open (Approve/Deny + details)
                  </Link>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      disabled={!canAct || isBusy}
                      onClick={() => approve(r.id)}
                      style={{
                        ...btnOk,
                        opacity: !canAct || isBusy ? 0.6 : 1,
                        cursor: !canAct || isBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      {isBusy ? "Working…" : "Approve"}
                    </button>

                    <button
                      disabled={!canAct || isBusy}
                      onClick={() => deny(r.id)}
                      style={{
                        ...btnDanger,
                        opacity: !canAct || isBusy ? 0.6 : 1,
                        cursor: !canAct || isBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      Deny
                    </button>

                    <button
                      disabled={!canAct || isBusy}
                      onClick={() => setLockbox(r.id)}
                      style={{
                        ...btnGhost,
                        opacity: !canAct || isBusy ? 0.6 : 1,
                        cursor: !canAct || isBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      Set lockbox
                    </button>
                  </div>

                  <button
                    disabled={!canDownloadBundle || isBusy}
                    onClick={() => downloadEvidenceBundle(r.id, setError, setBusyId)}
                    style={{
                      ...btnPrimary,
                      opacity: !canDownloadBundle || isBusy ? 0.6 : 1,
                      cursor: !canDownloadBundle || isBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {isBusy ? "Preparing…" : "Download Evidence Bundle"}
                  </button>

                  {!canDownloadBundle && (
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      Available after return confirmation.
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        background: "#f3f4f6",
        color: "#111827",
        fontSize: 12,
        fontWeight: 900,
      }}
    >
      {label}
    </span>
  );
}

function Badge({ value }: { value: string }) {
  const v = String(value || "").toLowerCase();
  const color =
    v === "approved" || v === "refunded" || v === "complete" || v === "yes" || v === "active"
      ? "#16a34a"
      : v === "pending" || v === "draft" || v === "not_started"
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
        fontWeight: 900,
      }}
    >
      {value}
    </span>
  );
}

async function downloadEvidenceBundle(
  rentalId: string,
  setError: (v: string | null) => void,
  setBusyId: (v: string | null) => void
) {
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

/* ---------------- styles ---------------- */

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
};

const btnPrimaryLink: React.CSSProperties = {
  ...btnPrimary,
  display: "inline-block",
  textDecoration: "none",
  textAlign: "center",
};

const btnOk: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#16a34a",
  color: "#fff",
  fontWeight: 900,
};

const btnDanger: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#b91c1c",
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