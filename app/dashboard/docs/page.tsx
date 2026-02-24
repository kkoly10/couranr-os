"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocRow = Record<string, any>;

export default function DashboardDocsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const session = sessionRes.session;

    if (!session) {
      router.push("/login?next=%2Fdashboard%2Fdocs");
      return;
    }

    const { data, error } = await supabase
      .from("docs_requests")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data as any[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentRows = useMemo(
    () => rows.filter((r) => !isTerminalStatus(getStatus(r))),
    [rows]
  );

  const historyRows = useMemo(
    () => rows.filter((r) => isTerminalStatus(getStatus(r))),
    [rows]
  );

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: 20 }}>
      <div
        style={{
          border: "1px solid #e5e7eb",
          background: "#fff",
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, color: "#111827" }}>Docs Dashboard</h1>
            <p style={{ margin: "6px 0 0", color: "#6b7280" }}>
              Manage your printing, typing, document-prep, and clerical support requests.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/docs/request" style={btnPrimary}>
              New Docs Request
            </Link>
            <Link href="/docs/pricing" style={btnGhost}>
              View Pricing
            </Link>
            <button onClick={load} style={btnGhostBtn}>
              Refresh
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip label={`Total: ${rows.length}`} />
          <Chip label={`Current: ${currentRows.length}`} />
          <Chip label={`History: ${historyRows.length}`} />
        </div>
      </div>

      {loading && (
        <div style={panelStyle}>
          <p style={{ margin: 0 }}>Loading docs requests…</p>
        </div>
      )}

      {error && (
        <div
          style={{
            ...panelStyle,
            borderColor: "#fecaca",
            background: "#fff",
          }}
        >
          <strong style={{ color: "#b91c1c" }}>Error:</strong>{" "}
          <span style={{ color: "#111827" }}>{error}</span>
          <div style={{ marginTop: 8, color: "#6b7280", fontSize: 13 }}>
            If this is a table/policy issue, verify the <code>docs_requests</code> table and customer
            read policy are deployed.
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          <SectionCard
            title="Current Requests"
            subtitle="Requests still in progress (submitted, paid, in progress, ready, etc.)"
          >
            {currentRows.length === 0 ? (
              <EmptyState
                text="You don’t have any active docs requests."
                actionHref="/docs/request"
                actionLabel="Start a docs request"
              />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {currentRows.map((r) => (
                  <DocRequestCard key={String(r.id)} row={r} detailHref={`/dashboard/docs/${r.id}`} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="History & Drafts"
            subtitle="Completed, cancelled, or draft requests"
          >
            {historyRows.length === 0 ? (
              <div style={{ color: "#6b7280", fontSize: 14 }}>No docs history yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {historyRows.map((r) => (
                  <DocRequestCard key={String(r.id)} row={r} detailHref={`/dashboard/docs/${r.id}`} />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

function DocRequestCard({ row, detailHref }: { row: DocRow; detailHref: string }) {
  const status = getStatus(row);
  const service = getServiceLabel(row);
  const amountCents = getAmountCents(row);
  const createdAt = getDateLabel(row.created_at);
  const updatedAt = getDateLabel(row.updated_at);
  const paid = !!(row.paid ?? row.is_paid ?? false);

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 14,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ lineHeight: 1.65, minWidth: 280 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <strong style={{ color: "#111827" }}>{service}</strong>
            <Badge value={status} />
            <Badge value={paid ? "paid" : "unpaid"} />
          </div>

          <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>
            <strong>Request ID:</strong> {String(row.id)}
          </div>

          <div style={{ fontSize: 13, color: "#374151" }}>
            <strong>Created:</strong> {createdAt}
          </div>

          {updatedAt && (
            <div style={{ fontSize: 13, color: "#374151" }}>
              <strong>Updated:</strong> {updatedAt}
            </div>
          )}

          {typeof amountCents === "number" && (
            <div style={{ fontSize: 13, color: "#374151" }}>
              <strong>Total:</strong> ${(amountCents / 100).toFixed(2)}
            </div>
          )}

          {getShortNotes(row) && (
            <div style={{ marginTop: 6, fontSize: 13, color: "#4b5563" }}>
              <strong>Notes:</strong> {getShortNotes(row)}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
          <Link href={detailHref} style={btnPrimary}>
            View Details
          </Link>

          {status === "draft" && (
            <Link href={`/docs/request?requestId=${encodeURIComponent(String(row.id))}`} style={btnGhost}>
              Continue Draft
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={panelStyle}>
      <h2 style={{ margin: 0, fontSize: 20, color: "#111827" }}>{title}</h2>
      {subtitle ? (
        <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>{subtitle}</p>
      ) : null}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

function EmptyState({
  text,
  actionHref,
  actionLabel,
}: {
  text: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div
      style={{
        border: "1px dashed #d1d5db",
        borderRadius: 12,
        padding: 16,
        background: "#fafafa",
      }}
    >
      <p style={{ margin: 0, color: "#374151" }}>{text}</p>
      <Link href={actionHref} style={{ ...btnPrimary, marginTop: 10, display: "inline-block" }}>
        {actionLabel}
      </Link>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        background: "#f3f4f6",
        color: "#111827",
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {label}
    </span>
  );
}

function Badge({ value }: { value: string }) {
  const v = String(value || "").toLowerCase();
  const color =
    v === "completed" || v === "ready" || v === "paid" || v === "delivered"
      ? "#16a34a"
      : v === "pending" || v === "submitted" || v === "in_progress" || v === "draft" || v === "unpaid"
      ? "#ca8a04"
      : v === "cancelled" || v === "denied" || v === "failed"
      ? "#dc2626"
      : "#374151";

  return (
    <span
      style={{
        padding: "2px 10px",
        borderRadius: 999,
        background: "#f3f4f6",
        color,
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {value}
    </span>
  );
}

/* ---------- helpers ---------- */

function getStatus(r: DocRow): string {
  return String(
    r.status ??
      r.request_status ??
      r.stage ??
      "submitted"
  );
}

function isTerminalStatus(status: string) {
  const s = String(status).toLowerCase();
  return s === "completed" || s === "cancelled" || s === "canceled" || s === "draft";
}

function getServiceLabel(r: DocRow): string {
  return String(
    r.service_type ??
      r.request_type ??
      r.category ??
      r.service ??
      "Docs Request"
  );
}

function getAmountCents(r: DocRow): number | null {
  const candidates = [
    r.total_cents,
    r.quote_total_cents,
    r.amount_cents,
    r.amount_total_cents,
    r.total_amount_cents,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function getDateLabel(v: any): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function getShortNotes(r: DocRow): string | null {
  const raw =
    r.notes ??
    r.customer_notes ??
    r.instructions ??
    r.description ??
    null;

  if (!raw) return null;
  const txt = String(raw).trim();
  if (!txt) return null;
  return txt.length > 140 ? `${txt.slice(0, 140)}…` : txt;
}

/* ---------- styles ---------- */

const panelStyle: React.CSSProperties = {
  marginTop: 14,
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 16,
  padding: 16,
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 800,
  textDecoration: "none",
  display: "inline-block",
  textAlign: "center",
};

const btnGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  fontWeight: 700,
  textDecoration: "none",
  display: "inline-block",
  textAlign: "center",
};

const btnGhostBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  fontWeight: 700,
  cursor: "pointer",
};
