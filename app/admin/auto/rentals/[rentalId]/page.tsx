"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Detail = {
  id: string;
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
  photos: Array<{ phase: string; photo_url: string; captured_at: string | null; captured_lat: number | null; captured_lng: number | null }>;
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
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Request failed");
    return json;
  }

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const json = await api(`/api/admin/auto/rental-detail?rentalId=${encodeURIComponent(rentalId)}`);
      setD(json.detail);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
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

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!d) return <p style={{ padding: 24 }}>Not found.</p>;

  const v: any = d.vehicles;
  const label = v ? `${v.year} ${v.make} ${v.model}` : "Vehicle";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <button onClick={() => router.push("/admin/auto/rentals")} style={btnGhost}>
        ← Back
      </button>

      <h1 style={{ marginTop: 14, marginBottom: 6 }}>{label}</h1>
      <div style={{ color: "#6b7280", fontSize: 13 }}>
        Verification: <strong>{d.verification_status}</strong> • Paid: <strong>{d.paid ? "yes" : "no"}</strong> •
        Docs: <strong>{d.docs_complete ? "yes" : "no"}</strong> • Agreement: <strong>{d.agreement_signed ? "yes" : "no"}</strong>
      </div>

      {err && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #fecaca" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {err}
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button disabled={saving} onClick={approve} style={btnPrimary}>Approve</button>
        <button disabled={saving} onClick={deny} style={btnDanger}>Deny</button>
        <button disabled={saving} onClick={setLockbox} style={btnGhost}>Set lockbox code</button>
        <button disabled={saving} onClick={() => notify("approved")} style={btnGhost}>Notify: Approved</button>
        <button disabled={saving} onClick={() => notify("return_reminder")} style={btnGhost}>Notify: Return reminder</button>
      </div>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <div style={card}>
          <strong>Lockbox</strong>
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Code: <strong>{d.lockbox_code || "—"}</strong>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>
            Released at: {d.lockbox_code_released_at || "—"}
          </div>
        </div>

        <div style={card}>
          <strong>Verification uploads</strong>
          <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
            (Open in a new tab)
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <a href={d.renter_verifications?.license_front_url || "#"} target="_blank">License (front)</a>
            <a href={d.renter_verifications?.license_back_url || "#"} target="_blank">License (back)</a>
            <a href={d.renter_verifications?.selfie_url || "#"} target="_blank">Selfie</a>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {d.photos.map((p, idx) => (
            <div key={idx} style={card}>
              <strong style={{ fontSize: 14 }}>{p.phase}</strong>
              <div style={{ marginTop: 8 }}>
                <img src={p.photo_url} alt={p.phase} style={{ width: "100%", borderRadius: 12, border: "1px solid #e5e7eb" }} />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                Time: {p.captured_at || "—"}<br />
                GPS: {p.captured_lat ?? "—"}, {p.captured_lng ?? "—"}
              </div>
              <a href={p.photo_url} target="_blank" style={{ fontSize: 12, marginTop: 8, display: "inline-block" }}>
                Open original
              </a>
            </div>
          ))}
        </div>
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

const btnDanger: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  background: "#b91c1c",
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