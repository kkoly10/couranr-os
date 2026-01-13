"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Row = {
  id: string;
  created_at: string;
  verification_status: string;
  docs_complete: boolean;
  agreement_signed: boolean;
  paid: boolean;
  condition_photos_status: string;
  lockbox_code: string | null;
  vehicles: { year: number; make: string; model: string } | null;
};

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

export default function AdminAutoRentals() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setErr(null);

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.push("/login?next=/admin/auto/rentals");
        return;
      }

      try {
        const res = await fetch("/api/admin/auto/rentals", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load rentals");
        setRows(json.rentals || []);
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 32 }}>Admin — Auto rentals</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        Review verification uploads, approve/deny, issue lockbox codes, and review photos.
      </p>

      {err && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #fecaca" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {err}
        </div>
      )}

      {rows.length === 0 && <p style={{ marginTop: 16 }}>No rentals found.</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {rows.map((r) => {
          const v: any = r.vehicles;
          const label = v ? `${v.year} ${v.make} ${v.model}` : "Vehicle";
          return (
            <div key={r.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <strong>{label}</strong>
                  <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>
                    Created: {fmt(r.created_at)} • Verif: <strong>{r.verification_status}</strong> • Paid:{" "}
                    <strong>{r.paid ? "yes" : "no"}</strong>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>
                    Docs: {r.docs_complete ? "✅" : "⏳"} • Agreement: {r.agreement_signed ? "✅" : "⏳"} • Photos:{" "}
                    {r.condition_photos_status}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Link href={`/admin/auto/rentals/${r.id}`} style={btnPrimary}>
                    Open
                  </Link>
                </div>
              </div>

              {r.lockbox_code && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  Lockbox: <strong>{r.lockbox_code}</strong>
                </div>
              )}
            </div>
          );
        })}
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
  display: "inline-block",
  padding: "10px 14px",
  borderRadius: 12,
  background: "#111827",
  color: "#fff",
  textDecoration: "none",
  fontWeight: 900,
};