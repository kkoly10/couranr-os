// app/dashboard/docs/[requestId]/DocsRequestDetailClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocRequest = {
  id: string;
  request_code?: string | null;
  service_type?: string | null;
  title?: string | null;
  description?: string | null;
  delivery_method?: string | null;
  phone?: string | null;
  status?: string | null;
  paid?: boolean | null;
  quoted_total_cents?: number | null;
  final_total_cents?: number | null;
  quoted_at?: string | null;
  submitted_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DocFile = {
  id: string;
  display_name?: string;
  file_name?: string;
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

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; request: DocRequest; files: DocFile[]; events: DocEvent[] };

export default function DocsRequestDetailClient({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  async function load() {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.push(`/login?next=${encodeURIComponent(`/dashboard/docs/${requestId}`)}`);
        return;
      }

      const res = await fetch(
        `/api/docs/my-request-detail?requestId=${encodeURIComponent(requestId)}&t=${Date.now()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load request");

      setState({
        kind: "ready",
        request: json.request,
        files: json.files || [],
        events: json.events || [],
      });
    } catch (e: any) {
      setState({ kind: "error", message: e?.message || "Failed to load" });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const summary = useMemo(() => {
    if (state.kind !== "ready") return null;
    const r = state.request;
    const status = String(r.status || "draft").toLowerCase();

    const isEditable = ["draft", "submitted"].includes(status);
    const isDone = ["completed", "cancelled"].includes(status);

    return { status, isEditable, isDone };
  }, [state]);

  if (state.kind === "loading") return <p style={{ padding: 24 }}>Loading Docs request…</p>;
  if (state.kind === "error") return <p style={{ padding: 24, color: "red" }}>Error: {state.message}</p>;

  const { request, files, events } = state;

  return (
    <div style={styles.container}>
      <div style={styles.top}>
        <div>
          <div style={{ marginBottom: 8 }}>
            <Link href="/dashboard/docs" style={styles.btnGhost}>← Back to Docs Dashboard</Link>
          </div>
          <h1 style={styles.h1}>{request.title || "Docs Request"}</h1>
          <p style={styles.sub}>
            Request Code: <strong>{request.request_code || "—"}</strong>
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={load} style={styles.btnGhost}>Refresh</button>
          {summary?.isEditable ? (
            <Link href={`/docs/request?requestId=${encodeURIComponent(request.id)}`} style={styles.btnPrimary}>
              Edit Request
            </Link>
          ) : null}
        </div>
      </div>

      <div style={styles.grid}>
        <section style={styles.card}>
          <h2 style={styles.h2}>Status</h2>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge value={String(request.status || "draft")} />
            {request.paid ? <Badge value="paid" /> : null}
          </div>

          <div style={{ marginTop: 10, fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
            <div><strong>Service:</strong> {prettyService(request.service_type)}</div>
            <div><strong>Delivery Method:</strong> {prettyService(request.delivery_method)}</div>
            <div><strong>Phone:</strong> {request.phone || "—"}</div>
            <div><strong>Created:</strong> {fmtDateTime(request.created_at)}</div>
            <div><strong>Updated:</strong> {fmtDateTime(request.updated_at)}</div>
            {request.submitted_at ? <div><strong>Submitted:</strong> {fmtDateTime(request.submitted_at)}</div> : null}
            {request.completed_at ? <div><strong>Completed:</strong> {fmtDateTime(request.completed_at)}</div> : null}
          </div>

          {(request.quoted_total_cents ?? request.final_total_cents) ? (
            <div style={styles.notice}>
              <div>
                <strong>Total / Quote:</strong>{" "}
                {formatMoney((request.final_total_cents ?? request.quoted_total_cents) || 0)}
              </div>
              {!request.paid && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Payment step can be connected next in <code>/docs/checkout</code>.
                </div>
              )}
            </div>
          ) : null}

          {request.description ? (
            <>
              <h3 style={{ marginTop: 14, marginBottom: 6, fontSize: 15 }}>Instructions</h3>
              <div style={styles.readBox}>{request.description}</div>
            </>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>Uploaded Files</h2>

          {files.length === 0 ? (
            <p style={{ margin: 0, color: "#6b7280" }}>No files uploaded.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {files.map((f, i) => (
                <div key={f.id || i} style={styles.fileRow}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {f.display_name || f.file_name || `File ${i + 1}`}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {f.mime_type || "file"} •{" "}
                      {typeof f.size_bytes === "number"
                        ? `${Math.round(f.size_bytes / 1024)} KB`
                        : "—"}{" "}
                      • {fmtDateTime(f.created_at)}
                    </div>
                  </div>

                  {f.signed_url ? (
                    <a href={f.signed_url} target="_blank" style={styles.btnGhost}>
                      Open
                    </a>
                  ) : (
                    <span style={{ ...styles.btnGhost, opacity: 0.6 }}>No URL</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section style={{ ...styles.card, marginTop: 12 }}>
        <h2 style={styles.h2}>Timeline</h2>

        {events.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>No activity yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {events.map((e, idx) => (
              <div key={e.id || idx} style={styles.eventRow}>
                <div style={styles.eventDot} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                    {prettyEvent(e.event_type)}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {fmtDateTime(e.created_at)} • {String(e.actor_role || "system")}
                  </div>
                  {renderEventPayload(e.event_payload)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ ...styles.card, marginTop: 12 }}>
        <div style={{ fontSize: 13, color: "#92400e", lineHeight: 1.6, ...styles.disclaimer }}>
          <strong>Reminder:</strong> Couranr Docs provides administrative document and filing-prep support.
          We are not a law firm and do not provide legal advice. DMV/immigration guidance is document preparation
          assistance only.
        </div>
      </section>
    </div>
  );
}

function renderEventPayload(payload: any) {
  if (!payload) return null;

  const obj = typeof payload === "object" ? payload : null;
  if (!obj) return null;

  const bits: string[] = [];

  if (obj.file_name) bits.push(`File: ${obj.file_name}`);
  if (obj.request_code) bits.push(`Code: ${obj.request_code}`);
  if (obj.service_type) bits.push(`Service: ${prettyService(obj.service_type)}`);
  if (typeof obj.amount_cents === "number") bits.push(`Amount: ${formatMoney(obj.amount_cents)}`);
  if (typeof obj.amountCents === "number") bits.push(`Amount: ${formatMoney(obj.amountCents)}`);
  if (obj.decision) bits.push(`Decision: ${String(obj.decision)}`);
  if (obj.reason) bits.push(`Reason: ${String(obj.reason)}`);

  if (!bits.length) return null;

  return (
    <div style={{ fontSize: 12, color: "#374151", marginTop: 4, lineHeight: 1.5 }}>
      {bits.join(" • ")}
    </div>
  );
}

function prettyService(v?: string | null) {
  const s = String(v || "").trim();
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function prettyEvent(v?: string | null) {
  const s = String(v || "").trim();
  if (!s) return "Event";
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(cents || 0) / 100);
}

function Badge({ value }: { value: string }) {
  const v = String(value || "").toLowerCase();
  const color =
    v === "completed" || v === "paid" ? "#16a34a" :
    v === "draft" || v === "submitted" || v === "pending" ? "#ca8a04" :
    v === "cancelled" || v === "rejected" ? "#dc2626" :
    "#374151";

  return (
    <span
      style={{
        padding: "2px 10px",
        borderRadius: 999,
        background: "#f3f4f6",
        color,
        fontSize: 12,
        fontWeight: 800,
        textTransform: "uppercase",
      }}
    >
      {value}
    </span>
  );
}

const styles: Record<string, any> = {
  container: { maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "sans-serif" },
  top: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" },
  h1: { margin: 0, fontSize: 28, fontWeight: 900 },
  sub: { margin: 0, color: "#666", fontSize: 14 },
  grid: { marginTop: 12, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 },
  card: { border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, background: "#fff" },
  h2: { margin: "0 0 10px 0", fontSize: 18, fontWeight: 900 },
  notice: {
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#f8fafc",
    color: "#334155",
    fontSize: 13,
  },
  readBox: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    background: "#fafafa",
    whiteSpace: "pre-wrap",
    lineHeight: 1.5,
    fontSize: 14,
  },
  fileRow: {
    border: "1px solid #f1f5f9",
    borderRadius: 10,
    padding: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  eventRow: {
    borderTop: "1px solid #f3f4f6",
    paddingTop: 10,
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
  },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: "#111827",
    marginTop: 4,
    flexShrink: 0,
  },
  disclaimer: {
    border: "1px solid #fde68a",
    background: "#fffbeb",
    borderRadius: 10,
    padding: 10,
  },
  btnPrimary: {
    background: "#111827",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: 10,
    textDecoration: "none",
    border: "none",
    fontWeight: 900,
    display: "inline-block",
  },
  btnGhost: {
    background: "#fff",
    color: "#111",
    padding: "10px 14px",
    borderRadius: 10,
    textDecoration: "none",
    border: "1px solid #d1d5db",
    fontWeight: 900,
    display: "inline-block",
    cursor: "pointer",
  },
};
