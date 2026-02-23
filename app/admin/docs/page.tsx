// app/admin/docs/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type DocRequest = {
  id: string;
  request_code?: string | null;
  title?: string | null;
  service_type?: string | null;
  status?: string | null;
  paid?: boolean | null;
  quoted_total_cents?: number | null;
  final_total_cents?: number | null;
  created_at?: string | null;
  completed_at?: string | null;
};

export default function AdminDocsPage() {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<DocRequest[]>([]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Unauthorized");
    return token;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();

      const res = await fetch(`/api/admin/docs/requests?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load");

      setRequests(json.requests || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function callApi(path: string, body: any) {
    const token = await getToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Request failed");
    return json;
  }

  async function setQuote(requestId: string) {
    const dollars = prompt("Quote amount (USD). Example: 18.50", "0");
    if (dollars === null) return;

    const n = Number(dollars);
    if (!Number.isFinite(n) || n < 0) {
      alert("Invalid amount.");
      return;
    }

    const note = prompt("Optional quote note", "") || null;

    setBusyId(requestId);
    setError(null);
    try {
      await callApi("/api/admin/docs/set-quote", {
        requestId,
        amountCents: Math.round(n * 100),
        note,
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to set quote");
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(requestId: string, status: string) {
    const note = prompt(`Optional note for status: ${status}`, "") || null;

    setBusyId(requestId);
    setError(null);
    try {
      await callApi("/api/admin/docs/set-status", { requestId, status, note });
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to change status");
    } finally {
      setBusyId(null);
    }
  }

  async function markPaid(requestId: string, paid: boolean) {
    const note = prompt(paid ? "Payment note (optional)" : "Reason marking unpaid (optional)", "") || null;

    setBusyId(requestId);
    setError(null);
    try {
      await callApi("/api/admin/docs/mark-paid", { requestId, paid, note });
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to update paid status");
    } finally {
      setBusyId(null);
    }
  }

  const stats = useMemo(() => {
    const total = requests.length;
    const submitted = requests.filter((r) => String(r.status || "") === "submitted").length;
    const quoted = requests.filter((r) => String(r.status || "") === "quoted").length;
    const inProgress = requests.filter((r) => String(r.status || "") === "in_progress").length;
    const ready = requests.filter((r) => String(r.status || "") === "ready").length;
    return { total, submitted, quoted, inProgress, ready };
  }, [requests]);

  if (loading) return <p style={{ padding: 24 }}>Loading Docs admin…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Admin — Docs</h1>
          <p style={{ color: "#555", marginTop: 6 }}>
            Manage quotes, payment status, and request progress.
          </p>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip label={`Total: ${stats.total}`} />
            <Chip label={`Submitted: ${stats.submitted}`} />
            <Chip label={`Quoted: ${stats.quoted}`} />
            <Chip label={`In progress: ${stats.inProgress}`} />
            <Chip label={`Ready: ${stats.ready}`} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={btnPrimary}>Refresh</button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 14, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", padding: 12, borderRadius: 12 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {requests.length === 0 && <p style={{ marginTop: 16 }}>No docs requests found.</p>}

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        {requests.map((r) => {
          const isBusy = busyId === r.id;
          const amount = Number(r.final_total_cents ?? r.quoted_total_cents ?? 0);

          return (
            <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 14, background: "#fff", padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ lineHeight: 1.65 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontWeight: 900 }}>{r.title || "Docs Request"}</div>
                    <Badge value={String(r.status || "draft")} />
                    {r.paid ? <Badge value="paid" /> : null}
                  </div>
                  <div><strong>Code:</strong> {r.request_code || "—"}</div>
                  <div><strong>Service:</strong> {pretty(r.service_type)}</div>
                  <div><strong>Quote:</strong> {amount > 0 ? formatMoney(amount) : "Not set"}</div>
                  <div><strong>Created:</strong> {fmt(r.created_at)}</div>
                  {r.completed_at ? <div><strong>Completed:</strong> {fmt(r.completed_at)}</div> : null}
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>ID: {r.id}</div>
                </div>

                <div style={{ display: "grid", gap: 8, alignContent: "start", minWidth: 300 }}>
                  <Link href={`/admin/docs/requests/${r.id}`} style={btnPrimaryLink}>
                    Open Detail
                  </Link>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button disabled={isBusy} onClick={() => setQuote(r.id)} style={btnGhostBtn}>
                      {isBusy ? "..." : "Set Quote"}
                    </button>
                    <button disabled={isBusy} onClick={() => markPaid(r.id, !r.paid)} style={btnGhostBtn}>
                      {r.paid ? "Mark Unpaid" : "Mark Paid"}
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button disabled={isBusy} onClick={() => setStatus(r.id, "quoted")} style={btnGhostBtn}>Quoted</button>
                    <button disabled={isBusy} onClick={() => setStatus(r.id, "in_progress")} style={btnGhostBtn}>In Progress</button>
                    <button disabled={isBusy} onClick={() => setStatus(r.id, "ready")} style={btnGhostBtn}>Ready</button>
                    <button disabled={isBusy} onClick={() => setStatus(r.id, "completed")} style={btnOk}>Complete</button>
                  </div>
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
  return <span style={{ padding: "6px 10px", borderRadius: 999, background: "#f3f4f6", fontWeight: 900, fontSize: 12 }}>{label}</span>;
}

function Badge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const color =
    v === "completed" || v === "paid" || v === "ready" ? "#16a34a" :
    v === "submitted" || v === "quoted" || v === "in_progress" ? "#ca8a04" :
    v === "cancelled" ? "#dc2626" :
    "#374151";

  return (
    <span style={{ padding: "2px 10px", borderRadius: 999, background: "#f3f4f6", color, fontSize: 12, fontWeight: 800 }}>
      {value}
    </span>
  );
}

function pretty(v?: string | null) {
  return String(v || "—").replace(/_/g, " ");
}

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

const btnPrimary: React.CSSProperties = {
  border: "none",
  background: "#111827",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 900,
  cursor: "pointer",
};

const btnPrimaryLink: React.CSSProperties = {
  ...btnPrimary,
  display: "inline-block",
  textDecoration: "none",
  textAlign: "center",
};

const btnGhostBtn: React.CSSProperties = {
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  borderRadius: 10,
  padding: "10px 12px",
  fontWeight: 900,
  cursor: "pointer",
};

const btnOk: React.CSSProperties = {
  border: "none",
  background: "#16a34a",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 12px",
  fontWeight: 900,
  cursor: "pointer",
};