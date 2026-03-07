"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getStoredBusinessAccountId, isUuid, resolveBusinessAccountId } from "@/lib/businessSelection";

type Delivery = {
  id: string;
  status: string;
  created_at: string;
  scheduled_at?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  delivery_notes?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  order?: { order_number?: string | null; total_cents?: number | null } | null;
};

const STATUS_OPTIONS = ["", "pending", "in_transit", "completed", "cancelled"];

export default function BusinessDeliveriesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState<string | null>(null);
  const [rows, setRows] = useState<Delivery[]>([]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.push("/login?next=%2Fdashboard%2Fbusiness%2Fdeliveries");
        return;
      }

      const id = resolveBusinessAccountId(new URLSearchParams(window.location.search).get("businessAccountId"));
      const selectedId = id || getStoredBusinessAccountId();
      if (!selectedId || !isUuid(selectedId)) {
        setError("Choose a business account first from the Business Portal page.");
        setRows([]);
        return;
      }
      setBusinessAccountId(selectedId);

      const qp = new URLSearchParams({ businessAccountId: selectedId });
      if (status) qp.set("status", status);

      const res = await fetch(`/api/business/deliveries?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load business deliveries");
      setRows((json?.deliveries || []) as Delivery[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load deliveries");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const csvHref = useMemo(() => {
    if (!rows.length) return null;
    const header = ["id", "status", "created_at", "recipient_name", "pickup", "dropoff", "order_number", "total_usd"];
    const lines = rows.map((r) => [
      r.id,
      r.status,
      r.created_at || "",
      r.recipient_name || "",
      r.pickup_address || "",
      r.dropoff_address || "",
      r.order?.order_number || "",
      (((r.order?.total_cents || 0) as number) / 100).toFixed(2),
    ]);
    const escape = (v: string) => `"${String(v).replaceAll('"', '""')}"`;
    const csv = [header, ...lines].map((line) => line.map((x) => escape(String(x))).join(",")).join("\n");
    return URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  }, [rows]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <div style={panel}>
        <h1 style={{ margin: 0 }}>Business Deliveries</h1>
        <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
          Ops view for delivery requests scoped to your selected business account.
        </p>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/dashboard/business" style={btnGhost}>Back to Business Portal</Link>
          <Link href={businessAccountId ? `/courier/quote?businessAccountId=${encodeURIComponent(businessAccountId)}` : "/courier/quote"} style={btnPrimary}>New delivery</Link>
          {csvHref && (
            <a href={csvHref} download="business-deliveries.csv" style={btnGhost}>Export CSV</a>
          )}
        </div>
      </div>

      <div style={{ ...panel, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Status</strong>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px" }}>
          {STATUS_OPTIONS.map((s) => <option key={s || "all"} value={s}>{s || "all"}</option>)}
        </select>
        <button onClick={load} style={btnGhostBtn}>Refresh</button>
      </div>

      {loading && <div style={panel}>Loading…</div>}
      {error && <div style={{ ...panel, borderColor: "#fecaca", color: "#b91c1c" }}>{error}</div>}

      {!loading && !error && rows.length === 0 && <div style={panel}>No deliveries for this filter yet.</div>}

      {!loading && !error && rows.map((d) => (
        <div key={d.id} style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, color: "#111827" }}>{d.order?.order_number || d.id.slice(0, 8)}</div>
              <div style={{ fontSize: 13, color: "#6b7280" }}>{new Date(d.created_at).toLocaleString()}</div>
            </div>
            <span style={{ border: "1px solid #d1d5db", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>{d.status || "—"}</span>
          </div>
          <div style={{ marginTop: 10, color: "#374151", fontSize: 14, lineHeight: 1.7 }}>
            <div><strong>Pickup:</strong> {d.pickup_address || "—"}</div>
            <div><strong>Dropoff:</strong> {d.dropoff_address || "—"}</div>
            <div><strong>Recipient:</strong> {d.recipient_name || "—"} {d.recipient_phone ? `(${d.recipient_phone})` : ""}</div>
            <div><strong>Total:</strong> ${(((d.order?.total_cents || 0) as number) / 100).toFixed(2)}</div>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/dashboard/delivery" style={btnGhost}>Open detail</Link>
            <Link href={businessAccountId ? `/courier/quote?businessAccountId=${encodeURIComponent(businessAccountId)}` : "/courier/quote"} style={btnGhost}>Re-order similar route</Link>
          </div>
        </div>
      ))}
    </div>
  );
}

const panel: React.CSSProperties = {
  marginTop: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#fff",
  padding: 14,
};

const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  textDecoration: "none",
  background: "#111827",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 12px",
  fontWeight: 800,
  fontSize: 14,
};

const btnGhost: React.CSSProperties = {
  display: "inline-block",
  textDecoration: "none",
  background: "#fff",
  color: "#111827",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: "10px 12px",
  fontWeight: 700,
  fontSize: 14,
};

const btnGhostBtn: React.CSSProperties = {
  background: "#fff",
  color: "#111827",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: "8px 12px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
