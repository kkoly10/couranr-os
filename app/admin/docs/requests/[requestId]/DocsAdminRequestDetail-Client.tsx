// app/admin/docs/requests/[requestId]/DocsAdminRequestDetailClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type DocRequest = {
  id: string;
  request_code?: string | null;
  title?: string | null;
  description?: string | null;
  service_type?: string | null;
  delivery_method?: string | null;
  phone?: string | null;
  status?: string | null;
  paid?: boolean | null;
  quoted_total_cents?: number | null;
  final_total_cents?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

type DocFile = {
  id: string;
  display_name?: string;
  mime_type?: string;
  size_bytes?: number;
  created_at?: string;
  signed_url?: string | null;
};

type DocEvent = {
  id: string;
  event_type?: string;
  actor_role?: string;
  created_at?: string;
  event_payload?: any;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; request: DocRequest; files: DocFile[]; events: DocEvent[] };

export default function DocsAdminRequestDetailClient({ requestId }: { requestId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Unauthorized");
    return token;
  }

  async function load() {
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/docs/request-detail?requestId=${encodeURIComponent(requestId)}&t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load");

      setState({ kind: "ready", request: json.request, files: json.files || [], events: json.events || [] });
    } catch (e: any) {
      setState({ kind: "error", message: e?.message || "Failed to load" });
    }
  }

  useEffect(() => {
    load();
  }, [requestId]);

  async function post(path: string, body: any, busyKey: string) {
    setBusy(busyKey);
    try {
      const token = await getToken();
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Request failed");

      await load();
    } catch (e: any) {
      alert(e?.message || "Request failed");
    } finally {
      setBusy(null);
    }
  }

  function actionSetQuote() {
    const dollars = prompt("Quote amount (USD). Example: 18.50", "0");
    if (dollars === null) return;
    const n = Number(dollars);
    if (!Number.isFinite(n) || n < 0) return alert("Invalid amount.");
    const note = prompt("Optional quote note", "") || null;
    post("/api/admin/docs/set-quote", { requestId, amountCents: Math.round(n * 100), note }, "quote");
  }

  function actionSetStatus(status: string) {
    const note = prompt(`Optional note for ${status}`, "") || null;
    post("/api/admin/docs/set-status", { requestId, status, note }, `status-${status}`);
  }

  function actionMarkPaid(paid: boolean) {
    const note = prompt(paid ? "Payment note (optional)" : "Reason marking unpaid (optional)", "") || null;
    post("/api/admin/docs/mark-paid", { requestId, paid, note }, paid ? "mark-paid" : "mark-unpaid");
  }

  const summary = useMemo(() => {
    if (state.kind !== "ready") return null;
    const r = state.request;
    const amount = Number(r.final_total_cents ?? r.quoted_total_cents ?? 0);
    return { amount };
  }, [state]);

  if (state.kind === "loading") return <p style={{ padding: 24 }}>Loading request…</p>;
  if (state.kind === "error") return <p style={{ padding: 24, color: "red" }}>Error: {state.message}</p>;

  const { request, files, events } = state;

  return (
    <div style={{ maxWidth: 1150, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ marginBottom: 8 }}>
            <Link href="/admin/docs" style={btnGhostLink}>← Back to Docs Admin</Link>
          </div>
          <h1 style={{ margin: 0, fontSize: 28 }}>{request.title || "Docs Request"}</h1>
          <p style={{ margin: "6px 0 0 0", color: "#666" }}>
            Code: <strong>{request.request_code || "—"}</strong>
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={load} style={btnGhostBtn}>Refresh</button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 12 }}>
        <section style={card}>
          <h2 style={h2}>Request Summary</h2>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Badge value={String(request.status || "draft")} />
            {request.paid ? <Badge value="paid" /> : null}
          </div>

          <div style={{ lineHeight: 1.7, fontSize: 14, color: "#374151" }}>
            <div><strong>Service:</strong> {pretty(request.service_type)}</div>
            <div><strong>Delivery:</strong> {pretty(request.delivery_method)}</div>
            <div><strong>Phone:</strong> {request.phone || "—"}</div>
            <div><strong>Quote:</strong> {summary && summary.amount > 0 ? money(summary.amount) : "Not set"}</div>
            <div><strong>Created:</strong> {fmt(request.created_at)}</div>
            <div><strong>Updated:</strong> {fmt(request.updated_at)}</div>
            {request.completed_at ? <div><strong>Completed:</strong> {fmt(request.completed_at)}</div> : null}
            <div style={{ marginTop: 8 }}><strong>ID:</strong> {request.id}</div>
          </div>

          {request.description && (
            <>
              <h3 style={{ marginTop: 14, marginBottom: 6, fontSize: 15 }}>Customer Instructions</h3>
              <div style={readBox}>{request.description}</div>
            </>
          )}
        </section>

        <section style={card}>
          <h2 style={h2}>Actions</h2>

          <div style={{ display: "grid", gap: 8 }}>
            <button disabled={!!busy} onClick={actionSetQuote} style={btnGhostBtn}>
              {busy === "quote" ? "Working…" : "Set / Update Quote"}
            </button>

            <button disabled={!!busy} onClick={() => actionMarkPaid(!request.paid)} style={btnGhostBtn}>
              {busy === "mark-paid" || busy === "mark-unpaid"
                ? "Working…"
                : request.paid
                ? "Mark Unpaid"
                : "Mark Paid (Manual)"}
            </button>

            <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
              Status shortcuts
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={!!busy} onClick={() => actionSetStatus("quoted")} style={btnGhostBtnSmall}>Quoted</button>
              <button disabled={!!busy} onClick={() => actionSetStatus("in_progress")} style={btnGhostBtnSmall}>In Progress</button>
              <button disabled={!!busy} onClick={() => actionSetStatus("awaiting_customer")} style={btnGhostBtnSmall}>Awaiting Customer</button>
              <button disabled={!!busy} onClick={() => actionSetStatus("ready")} style={btnGhostBtnSmall}>Ready</button>
              <button disabled={!!busy} onClick={() => actionSetStatus("completed")} style={btnOkBtnSmall}>Completed</button>
              <button disabled={!!busy} onClick={() => actionSetStatus("cancelled")} style={btnDangerBtnSmall}>Cancelled</button>
            </div>
          </div>
        </section>
      </div>

      <section style={{ ...card, marginTop: 12 }}>
        <h2 style={h2}>Uploaded Files</h2>
        {files.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>No files uploaded.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {files.map((f, i) => (
              <div key={f.id || i} style={fileRow}>
                <div>
                  <div style={{ fontWeight: 800 }}>{f.display_name || `File ${i + 1}`}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {f.mime_type || "file"} • {typeof f.size_bytes === "number" ? `${Math.round(f.size_bytes / 1024)} KB` : "—"} • {fmt(f.created_at)}
                  </div>
                </div>

                {f.signed_url ? (
                  <a href={f.signed_url} target="_blank" style={btnGhostLink}>Open</a>
                ) : (
                  <span style={{ ...btnGhostLink, opacity: 0.6 }}>No URL</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ ...card, marginTop: 12 }}>
        <h2 style={h2}>Timeline</h2>
        {events.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>No events yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {events.map((e, i) => (
              <div key={e.id || i} style={eventRow}>
                <div style={dot} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800 }}>{pretty(e.event_type)}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {fmt(e.created_at)} • {e.actor_role || "system"}
                  </div>
                  {renderPayload(e.event_payload)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function renderPayload(payload: any) {
  if (!payload || typeof payload !== "object") return null;
  const bits: string[] = [];
  if (typeof payload.amount_cents === "number") bits.push(`Amount: ${money(payload.amount_cents)}`);
  if (typeof payload.amountCents === "number") bits.push(`Amount: ${money(payload.amountCents)}`);
  if (payload.note) bits.push(`Note: ${String(payload.note)}`);
  if (payload.status) bits.push(`Status: ${String(payload.status)}`);
  if (payload.status_after) bits.push(`After: ${String(payload.status_after)}`);
  if (payload.session_id) bits.push(`Session: ${String(payload.session_id)}`);
  return bits.length ? <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>{bits.join(" • ")}</div> : null;
}

function Badge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const color =
    v === "completed" || v === "paid" || v === "ready" ? "#16a34a" :
    v === "quoted" || v === "submitted" || v === "in_progress" || v === "awaiting_customer" ? "#ca8a04" :
    v === "cancelled" ? "#dc2626" :
    "#374151";

  return <span style={{ padding: "2px 10px", borderRadius: 999, background: "#f3f4f6", color, fontWeight: 800, fontSize: 12 }}>{value}</span>;
}

function pretty(v?: string | null) {
  return String(v || "—").replace(/_/g, " ");
}

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#fff",
  padding: 14,
};

const h2: React.CSSProperties = {
  margin: "0 0 10px 0",
  fontSize: 18,
  fontWeight: 900,
};

const readBox: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#fafafa",
  borderRadius: 10,
  padding: 10,
  whiteSpace: "pre-wrap",
  lineHeight: 1.5,
};

const fileRow: React.CSSProperties = {
  border: "1px solid #f1f5f9",
  borderRadius: 10,
  padding: 10,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
};

const eventRow: React.CSSProperties = {
  borderTop: "1px solid #f3f4f6",
  paddingTop: 10,
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
};

const dot: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  background: "#111827",
  marginTop: 4,
};

const btnGhostLink: React.CSSProperties = {
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  borderRadius: 10,
  padding: "8px 12px",
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-block",
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

const btnGhostBtnSmall: React.CSSProperties = {
  ...btnGhostBtn,
  padding: "8px 10px",
  fontSize: 12,
};

const btnOkBtnSmall: React.CSSProperties = {
  border: "none",
  background: "#16a34a",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 10px",
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 12,
};

const btnDangerBtnSmall: React.CSSProperties = {
  border: "none",
  background: "#dc2626",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 10px",
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 12,
};