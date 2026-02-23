// app/admin/auto/rentals/[rentalId]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Detail = {
  id: string;
  status: string | null;
  verification_status: "pending" | "approved" | "denied";
  verification_denial_reason: string | null;
  docs_complete: boolean;
  agreement_signed: boolean;
  paid: boolean;
  lockbox_code: string | null;
  lockbox_code_released_at: string | null;
  condition_photos_status: string;
  vehicles: { year: number; make: string; model: string } | null;
  renter_verifications: any | null;
  photos: Array<{
    phase: string;
    photo_url: string;
    captured_at: string | null;
    captured_lat: number | null;
    captured_lng: number | null;
  }>;
};

export default function AdminAutoRentalDetail() {
  const router = useRouter();
  const params = useParams<{ rentalId: string }>();
  const rentalId = params.rentalId;

  const [loading, setLoading] = useState(true);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function api(path: string, body?: any) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      throw new Error("Not logged in");
    }

    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
        : { Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Request failed");
    return json;
  }

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const url = `/api/admin/auto/rental-detail?rentalId=${encodeURIComponent(rentalId)}&t=${Date.now()}`;
      const json = await api(url);
      setD(json.detail);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
      // ✅ removed router.refresh() to avoid noisy rerenders
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalId]);

  async function approve() {
    if (!d) return;
    setSaving(true);
    setErr(null);
    try {
      await api("/api/admin/auto/set-verification", { rentalId, status: "approved" });
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function deny() {
    const reason = prompt("Reason for denial? (required)");
    if (!reason?.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await api("/api/admin/auto/set-verification", { rentalId, status: "denied", reason });
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  // STEP 1: Just stores the code securely
  async function setLockbox() {
    const code = prompt("Enter lockbox code (ex: 1234)");
    if (!code?.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await api("/api/admin/auto/set-lockbox", { rentalId, code: code.trim() });
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  // STEP 2: Releases the code to the customer dashboard
  async function releaseLockbox() {
    let code = d?.lockbox_code;
    if (!code) {
      code = prompt("No code saved yet. Enter lockbox code to release:");
      if (!code?.trim()) return;
    } else {
      if (!window.confirm(`Are you sure you want to release code [${code}] to the customer now?`)) return;
    }

    setSaving(true);
    setErr(null);
    try {
      const res = await api("/api/admin/auto/release-lockbox", { rentalId, lockboxCode: code });

      // ✅ instant UI update so admin sees status/button change immediately
      setD((prev) =>
        prev
          ? {
              ...prev,
              status: res?.rental?.status ?? "active",
              lockbox_code: res?.rental?.lockbox_code ?? String(code).trim(),
              lockbox_code_released_at:
                res?.rental?.lockbox_code_released_at ??
                res?.released_at ??
                new Date().toISOString(),
            }
          : prev
      );

      // ✅ cross-tab signal (same browser) for customer dashboard
      try {
        localStorage.setItem(
          "couranr:auto-lockbox-release",
          JSON.stringify({ rentalId, at: Date.now() })
        );
      } catch {}

      alert("Lockbox Released! The customer can now see it on their dashboard.");
      await load(); // canonical DB re-sync
    } catch (e: any) {
      setErr(e?.message || "Failed to release lockbox");
    } finally {
      setSaving(false);
    }
  }

  async function notify(type: string) {
    setSaving(true);
    setErr(null);
    try {
      await api("/api/auto/notify", { rentalId, type });
      alert("Notification sent.");
    } catch (e: any) {
      setErr(e?.message || "Failed to notify");
    } finally {
      setSaving(false);
    }
  }

  // CANCEL RENTAL LOGIC
  async function cancelRental() {
    const reason = prompt("Reason for cancellation? (This will be emailed to the customer)");
    if (reason === null) return;

    if (!window.confirm("Are you ABSOLUTELY sure? This will permanently cancel the rental in the system.")) return;

    setSaving(true);
    setErr(null);
    try {
      await api("/api/admin/auto/cancel-rental", { rentalId, reason: reason.trim() });
      alert("Rental successfully cancelled.");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to cancel rental");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!d) return <p style={{ padding: 24 }}>Not found.</p>;

  const v: any = d.vehicles;
  const label = v ? `${v.year} ${v.make} ${v.model}` : "Vehicle";

  const readyToRelease =
    d.verification_status === "approved" && d.paid && d.docs_complete && d.agreement_signed;
  const isCancelled = d.status === "cancelled";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <button onClick={() => router.push("/admin/auto")} style={btnGhost}>
        ← Back to Admin
      </button>

      <h1 style={{ marginTop: 14, marginBottom: 6, color: isCancelled ? "#9ca3af" : "#111" }}>
        {label} {isCancelled && "(CANCELLED)"}
      </h1>

      <div style={{ color: "#6b7280", fontSize: 13 }}>
        Status:{" "}
        <strong style={{ textTransform: "uppercase", color: isCancelled ? "#dc2626" : "#111" }}>
          {d.status}
        </strong>{" "}
        • Verification: <strong>{d.verification_status}</strong> • Paid:{" "}
        <strong>{d.paid ? "yes" : "no"}</strong> • Docs:{" "}
        <strong>{d.docs_complete ? "yes" : "no"}</strong> • Agreement:{" "}
        <strong>{d.agreement_signed ? "yes" : "no"}</strong>
      </div>

      {err && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #fecaca" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {err}
        </div>
      )}

      {/* ADMIN CONTROLS (Disabled if cancelled) */}
      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          padding: "16px",
          background: "#f9fafb",
          borderRadius: "12px",
          border: "1px solid #e5e7eb",
          opacity: isCancelled ? 0.5 : 1,
          pointerEvents: isCancelled ? "none" : "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            paddingRight: "16px",
            borderRight: "1px solid #d1d5db",
          }}
        >
          <button
            disabled={saving || d.verification_status === "approved"}
            onClick={approve}
            style={btnOk}
          >
            Approve ID
          </button>
          <button disabled={saving} onClick={deny} style={btnDanger}>
            Deny ID
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={saving} onClick={setLockbox} style={btnGhost}>
            1. Set Code {d.lockbox_code && "✅"}
          </button>

          <button
            disabled={saving || !!d.lockbox_code_released_at || !readyToRelease}
            onClick={releaseLockbox}
            style={d.lockbox_code_released_at ? btnGhost : btnPrimary}
          >
            {d.lockbox_code_released_at ? "Code Released ✅" : "2. Release Lockbox"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            paddingLeft: "16px",
            borderLeft: "1px solid #d1d5db",
          }}
        >
          <button disabled={saving} onClick={() => notify("approved")} style={btnGhost}>
            Notify: Approved
          </button>
          <button
            disabled={saving}
            onClick={() => notify("return_reminder")}
            style={btnGhost}
          >
            Notify: Return reminder
          </button>
        </div>
      </div>

      {!readyToRelease && !d.lockbox_code_released_at && !isCancelled && (
        <p style={{ fontSize: 13, color: "#b45309", marginTop: 8 }}>
          ⚠️ Cannot release lockbox until verification is approved, agreement is signed, and rental is
          paid.
        </p>
      )}

      <div
        style={{
          marginTop: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 12,
        }}
      >
        <div style={card}>
          <strong>Lockbox Status</strong>
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Code stored: <strong>{d.lockbox_code || "None set yet"}</strong>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: d.lockbox_code_released_at ? "#16a34a" : "#ca8a04",
              fontWeight: 700,
            }}
          >
            {d.lockbox_code_released_at
              ? `Released at: ${new Date(d.lockbox_code_released_at).toLocaleString()}`
              : "Not released to customer yet."}
          </div>
        </div>

        <div style={card}>
          <strong>Verification uploads</strong>
          <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>(Open in a new tab)</div>
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <a
              href={d.renter_verifications?.license_front_url || "#"}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#111", textDecoration: "underline" }}
            >
              License (front)
            </a>
            <a
              href={d.renter_verifications?.license_back_url || "#"}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#111", textDecoration: "underline" }}
            >
              License (back)
            </a>
            <a
              href={d.renter_verifications?.selfie_url || "#"}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#111", textDecoration: "underline" }}
            >
              Selfie
            </a>
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              State: <strong>{d.renter_verifications?.license_state || "—"}</strong> • Exp:{" "}
              <strong>{d.renter_verifications?.license_expires || "—"}</strong> • Insurance:{" "}
              <strong>{d.renter_verifications?.has_insurance ? "yes" : "no"}</strong>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ marginBottom: 10 }}>Condition photos</h2>
        {d.photos.length === 0 && <p>No photos uploaded yet.</p>}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {d.photos.map((p, idx) => (
            <div key={idx} style={card}>
              <strong style={{ fontSize: 14 }}>{p.phase}</strong>
              <div style={{ marginTop: 8 }}>
                <img
                  src={p.photo_url}
                  alt={p.phase}
                  style={{ width: "100%", borderRadius: 12, border: "1px solid #e5e7eb" }}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                Time: {p.captured_at ? new Date(p.captured_at).toLocaleString() : "—"}
                <br />
                GPS: {p.captured_lat ?? "—"}, {p.captured_lng ?? "—"}
              </div>
              <a
                href={p.photo_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 12,
                  marginTop: 8,
                  display: "inline-block",
                  color: "#111",
                  textDecoration: "underline",
                }}
              >
                Open original
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* DANGER ZONE */}
      <div
        style={{
          marginTop: 40,
          padding: 20,
          border: "1px solid #fecaca",
          borderRadius: 16,
          background: "#fef2f2",
        }}
      >
        <h3 style={{ margin: "0 0 10px 0", color: "#991b1b" }}>Danger Zone</h3>
        <p style={{ fontSize: 14, color: "#7f1d1d", marginBottom: 16 }}>
          Cancelling a rental will permanently lock the customer's dashboard and stop the flow. Note:
          If the customer has already paid, you must process their financial refund separately via your
          Stripe dashboard.
        </p>
        <button
          disabled={saving || isCancelled}
          onClick={cancelRental}
          style={{
            ...btnDanger,
            opacity: isCancelled ? 0.5 : 1,
            cursor: isCancelled ? "not-allowed" : "pointer",
          }}
        >
          {isCancelled ? "Rental Already Cancelled" : "Cancel Rental"}
        </button>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
};
const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};
const btnOk: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  background: "#16a34a",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  background: "#dc2626",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};