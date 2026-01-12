"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AccessClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    const res = await fetch(`/api/auto/get-lockbox-code?rentalId=${encodeURIComponent(rentalId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Not available yet.");
      setLoading(false);
      return;
    }

    setCode(data.code);
    setLoading(false);
  }

  useEffect(() => {
    if (!rentalId) setError("Missing rentalId.");
    else load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalId]);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1>Vehicle Access</h1>
      <p style={{ color: "#555" }}>
        Your lockbox code will appear only after approval, payment, and pickup photos.
      </p>

      {loading && <p>Loading…</p>}

      {error && (
        <div style={{ marginTop: 14, padding: 14, borderRadius: 12, border: "1px solid #fecaca", background: "#fff" }}>
          <strong style={{ color: "#b91c1c" }}>Not ready:</strong> {error}
          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Tip: Upload pickup exterior photos first, then return here.
          </div>
        </div>
      )}

      {code && (
        <div style={{ marginTop: 14, padding: 16, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Lockbox code</div>
          <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 2 }}>{code}</div>

          <div style={{ marginTop: 12, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
            After unlocking, take interior pickup photos inside the car (required).
          </div>

          <button
            style={{
              marginTop: 14,
              width: "100%",
              padding: "14px 18px",
              borderRadius: 12,
              border: "none",
              background: "#111827",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
            onClick={() => router.push(`/auto/condition?rentalId=${encodeURIComponent(rentalId)}&step=pickup_interior`)}
          >
            Upload interior pickup photos
          </button>
        </div>
      )}
    </div>
  );
}