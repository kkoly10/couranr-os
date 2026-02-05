"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function AdminAutoTestPage() {
  const [token, setToken] = useState<string | null>(null);
  const [rentalId, setRentalId] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [json, setJson] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setToken(data.session?.access_token ?? null);
    })();
  }, []);

  async function callDetail() {
    setErr(null);
    setJson(null);
    setStatus(null);

    if (!token) return setErr("No session token (not logged in).");
    if (!rentalId) return setErr("Enter a rentalId.");

    const res = await fetch(`/api/admin/auto/rental-detail?rentalId=${encodeURIComponent(rentalId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    setStatus(res.status);
    const data = await res.json().catch(() => ({}));
    setJson(data);
  }

  async function downloadBundle() {
    setErr(null);

    if (!token) return setErr("No session token (not logged in).");
    if (!rentalId) return setErr("Enter a rentalId.");

    const res = await fetch(`/api/admin/auto/evidence-bundle?rentalId=${encodeURIComponent(rentalId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setErr(data?.error || `Bundle failed (${res.status})`);
    }

    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match?.[1] || `evidence-${rentalId}.zip`;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 26 }}>Admin API Test</h1>
      <p style={{ color: "#555" }}>
        Quick verification for <code>/api/admin/auto/rental-detail</code> and <code>/api/admin/auto/evidence-bundle</code>.
      </p>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", fontWeight: 800 }}>Rental ID</label>
        <input
          value={rentalId}
          onChange={(e) => setRentalId(e.target.value)}
          placeholder="914af465-2d55-4eca-b254-2eeedefccbe3"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #d1d5db", marginTop: 6 }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={callDetail} style={btnPrimary}>Test rental-detail</button>
        <button onClick={downloadBundle} style={btnGhost}>Download evidence bundle</button>
      </div>

      {!token && (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #fed7aa", borderRadius: 12 }}>
          <strong>Not logged in.</strong> Go log in as admin first, then refresh this page.
        </div>
      )}

      {err && (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #fecaca", borderRadius: 12 }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {err}
        </div>
      )}

      {status !== null && (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <strong>Status:</strong> {status}
        </div>
      )}

      {json && (
        <pre style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#0b1220", color: "#e5e7eb", overflowX: "auto" }}>
{JSON.stringify(json, null, 2)}
        </pre>
      )}
    </div>
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
};