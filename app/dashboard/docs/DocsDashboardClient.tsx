// app/dashboard/docs/DocsDashboardClient.tsx
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
  status?: string | null;
  paid?: boolean | null;
  quoted_total_cents?: number | null;
  final_total_cents?: number | null;
  created_at?: string | null;
  submitted_at?: string | null;
  completed_at?: string | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "unauth" }
  | { kind: "error"; message: string }
  | { kind: "ready"; requests: DocRequest[] };

export default function DocsDashboardClient() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  async function load() {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setState({ kind: "unauth" });
        router.push("/login?next=/dashboard/docs");
        return;
      }

      const res = await fetch(`/api/docs/my-requests?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load requests");

      setState({ kind: "ready", requests: json.requests || [] });
    } catch (e: any) {
      setState({ kind: "error", message: e?.message || "Failed to load" });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ui = useMemo(() => {
    if (state.kind !== "ready") return null;

    const requests = state.requests || [];
    const historyStatuses = new Set(["completed", "cancelled"]);
    const current = requests.filter((r) => !historyStatuses.has(String(r.status || "").toLowerCase()));
    const history = requests.filter((r) => historyStatuses.has(String(r.status || "").toLowerCase()));

    return { current, history };
  }, [state]);

  if (state.kind === "loading") return <p style={{ padding: 24 }}>Loading Docs dashboard…</p>;
  if (state.kind === "error") return <p style={{ padding: 24, color: "red" }}>Error: {state.message}</p>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Docs Dashboard</h1>
          <p style={styles.sub}>Track your document requests, uploads, and status updates.</p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={load} style={styles.btnGhost}>Refresh</button>
          <Link href="/docs/request" style={styles.btnPrimary}>New Docs Request</Link>
        </div>
      </div>

      <SectionTitle title="Current Requests" />
      {ui?.current.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {ui.current.map((r) => (
            <RequestCard key={r.id} r={r} />
          ))}
        </div>
      ) : (
        <div style={styles.cardMuted}>You don’t have an active docs request right now.</div>
      )}

      <SectionTitle title="History" />
      {ui?.history.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {ui.history.map((r) => (
            <RequestCard key={r.id} r={r} />
          ))}
        </div>
      ) : (
        <div style={styles.cardMuted}>No completed/cancelled Docs requests yet.</div>
      )}
    </div>
  );
}

function RequestCard({ r }: { r: DocRequest }) {
  const status = String(r.status || "draft").toLowerCase();
  const isDraft = status === "draft";
  const amountCents = Number(r.final_total_cents ?? r.quoted_total_cents ?? 0);
  const canPay = !r.paid && amountCents > 0 && !["completed", "cancelled"].includes(status);

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>
              {r.title || "Docs Request"}
            </div>
            <Badge value={status} />
            {r.paid ? <Badge value="paid" /> : null}
          </div>

          <div style={{ marginTop: 6, fontSize: 13, color: "#374151", lineHeight: 1.65 }}>
            <div><strong>Code:</strong> {r.request_code || "—"}</div>
            <div><strong>Service:</strong> {prettyService(r.service_type)}</div>
            <div><strong>Created:</strong> {fmtDate(r.created_at)}</div>
            {r.submitted_at ? <div><strong>Submitted:</strong> {fmtDateTime(r.submitted_at)}</div> : null}
            {r.completed_at ? <div><strong>Completed:</strong> {fmtDateTime(r.completed_at)}</div> : null}
            <div><strong>Paid:</strong> {r.paid ? "Yes" : "No"}</div>
            {amountCents > 0 ? (
              <div><strong>Quote/Total:</strong> {formatMoney(amountCents)}</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, alignContent: "start", minWidth: 210 }}>
          <Link href={`/dashboard/docs/${r.id}`} style={styles.btnPrimaryLink}>
            View Details
          </Link>

          {canPay && (
            <Link href={`/docs/checkout?requestId=${encodeURIComponent(r.id)}`} style={styles.btnPrimaryLink}>
              Pay Now
            </Link>
          )}

          {isDraft && (
            <Link href={`/docs/request?requestId=${encodeURIComponent(r.id)}`} style={styles.btnGhost}>
              Continue Draft
            </Link>
          )}

          {!isDraft && (
            <Link href={`/docs/request?requestId=${encodeURIComponent(r.id)}`} style={styles.btnGhost}>
              View / Edit Request
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 style={{ marginTop: 20, marginBottom: 10, fontSize: 20, fontWeight: 900 }}>
      {title}
    </h2>
  );
}

function prettyService(v?: string | null) {
  const s = String(v || "").trim();
  if (!s) return "—";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
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
    v === "draft" || v === "submitted" || v === "pending" || v === "quoted" || v === "in_progress" ? "#ca8a04" :
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
  header: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" },
  h1: { margin: 0, fontSize: 28, fontWeight: 900 },
  sub: { margin: "6px 0 0 0", color: "#666", fontSize: 14 },
  card: { border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, background: "#fff" },
  cardMuted: { border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, background: "#fafafa", color: "#6b7280" },
  btnPrimary: {
    background: "#111827",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: 10,
    textDecoration: "none",
    border: "none",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnPrimaryLink: {
    background: "#111827",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: 10,
    textDecoration: "none",
    border: "none",
    fontWeight: 900,
    textAlign: "center",
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
    textAlign: "center",
    display: "inline-block",
    cursor: "pointer",
  },
};