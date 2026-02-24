"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocRow = Record<string, any>;

export default function AdminDocsDashboardPage() {
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
      router.push("/login?next=%2Fadmin%2Fdocs");
      return;
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profileErr) {
      setError(profileErr.message);
      setLoading(false);
      return;
    }

    if ((profile as any)?.role !== "admin") {
      setError("Admin access required.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("docs_requests")
      .select("*")
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

  const queued = useMemo(
    () => rows.filter((r) => !isTerminalStatus(getStatus(r))),
    [rows]
  );

  const done = useMemo(
    () => rows.filter((r) => isTerminalStatus(getStatus(r))),
    [rows]
  );

  const stats = useMemo(() => {
    const pending = rows.filter((r) => ["submitted", "pending", "received"].includes(getStatus(r).toLowerCase())).length;
    const inProgress = rows.filter((r) => ["in_progress", "processing"].includes(getStatus(r).toLowerCase())).length;
    const ready = rows.filter((r) => ["ready", "ready_for_pickup", "ready_for_delivery"].includes(getStatus(r).toLowerCase())).length;
    const paid = rows.filter((r) => !!(r.paid ?? r.is_paid)).length;

    return {
      total: rows.length,
      pending,
      inProgress,
      ready,
      paid,
    };
  }, [rows]);

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: 20 }}>
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          background: "#fff",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, color: "#111827" }}>Admin — Docs</h1>
            <p style={{ margin: "6px 0 0", color: "#6b7280" }}>
              Manage print jobs, clerical requests, pricing, and status updates.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/docs/pricing" style={btnGhost}>
              Public pricing page
            </Link>
            <button onClick={load} style={btnPrimaryBtn}>
              Refresh
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip label={`Total: ${stats.total}`} />
          <Chip label={`Pending: ${stats.pending}`} />
          <Chip label={`In progress: ${stats.inProgress}`} />
          <Chip label={`Ready: ${stats.ready}`} />
          <Chip label={`Paid: ${stats.paid}`} />
        </div>
      </div>

      {loading && <div style={panelStyle}>Loading docs requests…</div>}

      {error && (
        <div
          style={{
            ...panelStyle,
            borderColor: "#fecaca",
          }}
        >
          <strong style={{ color: "#b91c1c" }}>Error:</strong>{" "}
          <span style={{ color: "#111827" }}>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <>
          <Section title="Active Queue" subtitle="Requests that still need admin work or completion">
            {queued.length === 0 ? (
              <div style={{ color: "#6b7280", fontSize: 14 }}>No active docs requests.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {queued.map((r) => (
                  <AdminDocCard key={String(r.id)} row={r} />
                ))}
              </div>
            )}
          </Section>

          <Section title="Completed / Cancelled" subtitle="Past requests and archived items">
            {done.length === 0 ? (
              <div style={{ color: "#6b7280", fontSize: 14 }}>No completed/cancelled docs requests yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {done.map((r) => (
                  <AdminDocCard key={String(r.id)} row={r} />
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function AdminDocCard({ row }: { row: DocRow }) {
  const id = String(row.id);
  const status = getStatus(row);
  const service = getServiceLabel(row);
  const paid = !!(row.paid ?? row.is_paid ?? false);
  const amountCents = getAmountCents(row);

  const customerName =
    row.customer_name ||
    row.full_name ||
    row.name ||
    row.requester_name ||
    null;

  const customerEmail =
    row.customer_email ||
    row.email ||
    row.requester_email ||
    null;

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        background: "#fff",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ lineHeight: 1.65, minWidth: 320 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <strong style={{ color: "#111827" }}>{service}</strong>
            <Badge value={status} />
            <Badge value={paid ? "paid" : "unpaid"} />
          </div>

          <div style={{ marginTop: 4, fontSize: 13, color: "#374151" }}>
            <strong>Request ID:</strong> {id}
          </div>

          {customerName && (
            <div style={{ fontSize: 13, color: "#374151" }}>
              <strong>Customer:</strong> {String(customerName)}
            </div>
          )}

          {customerEmail && (
            <div style={{ fontSize: 13, color: "#374151" }}>
              <strong>Email:</strong> {String(customerEmail)}
            </div>
          )}

          <div style={{ fontSize: 13, color: "#374151" }}>
            <strong>Created:</strong> {formatDate(row.created_at)}
          </div>

          {row.updated_at && (
            <div style={{ fontSize: 13, color: "#374151" }}>
              <strong>Updated:</strong> {formatDate(row.updated_at)}
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
          <Link href={`/admin/docs/requests/${encodeURIComponent(id)}`} style={btnPrimary}>
            Open Request
          </Link>

          <Link href={`/dashboard/docs/${encodeURIComponent(id)}`} style={btnGhost}>
            Customer View Route
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({
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
      {subtitle && (
        <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>{subtitle}</p>
      )}
      <div style={{ marginTop: 12 }}>{children}</div>
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
      : v === "submitted" || v === "pending" || v === "received" || v === "in_progress" || v === "processing" || v === "unpaid"
      ? "#ca8a04"
      : v === "cancelled" || v === "canceled" || v === "failed"
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
  return String(r.status ?? r.request_status ?? r.stage ?? "submitted");
}

function isTerminalStatus(status: string) {
  const s = String(status).toLowerCase();
  return s === "completed" || s === "cancelled" || s === "canceled";
}

function getServiceLabel(r: DocRow): string {
  return String(r.service_type ?? r.request_type ?? r.category ?? r.service ?? "Docs Request");
}

function getAmountCents(r: DocRow): number | null {
  const vals = [
    r.total_cents,
    r.quote_total_cents,
    r.amount_cents,
    r.amount_total_cents,
    r.total_amount_cents,
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatDate(v: any) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function getShortNotes(r: DocRow): string | null {
  const raw = r.notes ?? r.customer_notes ?? r.instructions ?? r.description ?? null;
  if (!raw) return null;
  const txt = String(raw).trim();
  if (!txt) return null;
  return txt.length > 140 ? `${txt.slice(0, 140)}…` : txt;
}

/* ---------- styles ---------- */

const panelStyle: React.CSSProperties = {
  marginTop: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  background: "#fff",
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

const btnPrimaryBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};
