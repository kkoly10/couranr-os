"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocsRequest = {
  id: string;
  status?: string | null;
  service_type?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  title?: string | null;
  notes?: string | null;
  intake_notes?: string | null;
  admin_notes?: string | null;
  pricing_cents?: number | null;
  paid?: boolean | null;
  payment_status?: string | null;
  delivery_method?: string | null;
  delivery_address?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: any;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; detail: DocsRequest; files: any[] }
  | { kind: "error"; message: string };

export default function DocsAdminRequestDetailClient() {
  const router = useRouter();
  const params = useParams();
  const requestId = String((params as any)?.requestId || "");

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      throw new Error("Unauthorized");
    }
    return token;
  }

  async function fetchJsonWithAuth(url: string, init?: RequestInit) {
    const token = await getToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as any)?.error || "Request failed");
    return json as any;
  }

  async function load() {
    if (!requestId) {
      setState({ kind: "error", message: "Missing requestId in URL." });
      return;
    }

    setState({ kind: "loading" });

    try {
      // Try common route patterns so this still works even if your API naming changed
      const candidates = [
        `/api/admin/docs/request-detail?requestId=${encodeURIComponent(requestId)}&t=${Date.now()}`,
        `/api/admin/docs/requests/${encodeURIComponent(requestId)}?t=${Date.now()}`,
        `/api/admin/docs/requests/detail?requestId=${encodeURIComponent(requestId)}&t=${Date.now()}`,
      ];

      let data: any = null;
      let lastErr: any = null;

      for (const url of candidates) {
        try {
          data = await fetchJsonWithAuth(url);
          if (data) break;
        } catch (e: any) {
          lastErr = e;
        }
      }

      if (!data) throw lastErr || new Error("Failed to load docs request");

      const detail = (data.detail || data.request || data.docsRequest || data) as DocsRequest;
      const files = (data.files || data.attachments || detail.files || []) as any[];

      setState({ kind: "ready", detail, files });
      router.refresh();
    } catch (e: any) {
      setState({ kind: "error", message: e?.message || "Failed to load request" });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  async function updateStatus(nextStatus: string) {
    if (state.kind !== "ready") return;
    setBusy(nextStatus);

    try {
      const body = { requestId, status: nextStatus };

      const candidates = [
        { url: "/api/admin/docs/update-status", body },
        { url: "/api/admin/docs/request-status", body },
        { url: `/api/admin/docs/requests/${encodeURIComponent(requestId)}/status`, body: { status: nextStatus } },
      ];

      let ok = false;
      let lastErr: any = null;

      for (const c of candidates) {
        try {
          await fetchJsonWithAuth(c.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c.body),
          });
          ok = true;
          break;
        } catch (e: any) {
          lastErr = e;
        }
      }

      if (!ok) throw lastErr || new Error("Failed to update status");

      await load();
      alert(`Status updated to "${nextStatus}"`);
    } catch (e: any) {
      alert(e?.message || "Failed to update status");
    } finally {
      setBusy(null);
    }
  }

  const money = useMemo(() => {
    if (state.kind !== "ready") return null;
    const cents =
      Number(state.detail.pricing_cents ?? 0) ||
      Number(state.detail.price_cents ?? 0) ||
      Number(state.detail.total_cents ?? 0);
    return Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : null;
  }, [state]);

  if (state.kind === "loading") return <p style={{ padding: 24 }}>Loading docs request…</p>;

  if (state.kind === "error") {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <Link href="/admin/docs" style={btnGhost}>
          ← Back to Docs Admin
        </Link>

        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: "1px solid #fecaca", background: "#fff" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {state.message}
        </div>

        <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
          Request ID: <code>{requestId}</code>
        </div>
      </div>
    );
  }

  const d = state.detail;
  const files = state.files || [];

  const status = String(d.status || "pending").toLowerCase();
  const paidLabel =
    typeof d.paid === "boolean"
      ? d.paid
        ? "Yes"
        : "No"
      : d.payment_status
      ? String(d.payment_status)
      : "—";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <Link href="/admin/docs" style={btnGhost}>
            ← Back to Docs Admin
          </Link>
          <h1 style={{ margin: "12px 0 4px 0", fontSize: 28 }}>
            Docs Request {d.title ? `— ${d.title}` : ""}
          </h1>
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            Request ID: <code>{d.id}</code>
          </div>
        </div>

        <button onClick={load} style={btnPrimary}>
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <div style={card}>
          <h3 style={h3}>Request Summary</h3>
          <Line label="Status" value={<Badge value={status} />} />
          <Line label="Service" value={d.service_type || "—"} />
          <Line label="Paid" value={paidLabel} />
          <Line label="Price" value={money || "—"} />
          <Line label="Delivery Method" value={d.delivery_method || "—"} />
          <Line label="Created" value={d.created_at ? new Date(d.created_at).toLocaleString() : "—"} />
          <Line label="Updated" value={d.updated_at ? new Date(d.updated_at).toLocaleString() : "—"} />
        </div>

        <div style={card}>
          <h3 style={h3}>Customer</h3>
          <Line label="Name" value={d.customer_name || "—"} />
          <Line label="Email" value={d.customer_email || "—"} />
          <Line label="Phone" value={d.customer_phone || "—"} />
          <Line label="Address" value={d.delivery_address || "—"} />
        </div>
      </div>

      <div style={{ marginTop: 12, ...card }}>
        <h3 style={h3}>Notes</h3>
        <div style={{ whiteSpace: "pre-wrap", color: "#374151", fontSize: 14 }}>
          {d.notes || d.intake_notes || d.admin_notes || "No notes yet."}
        </div>
      </div>

      <div style={{ marginTop: 12, ...card }}>
        <h3 style={h3}>Admin Actions</h3>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={!!busy} onClick={() => updateStatus("received")} style={btnGhostBtn}>
            {busy === "received" ? "Working…" : "Mark Received"}
          </button>
          <button disabled={!!busy} onClick={() => updateStatus("in_progress")} style={btnPrimary}>
            {busy === "in_progress" ? "Working…" : "Mark In Progress"}
          </button>
          <button disabled={!!busy} onClick={() => updateStatus("ready")} style={btnOk}>
            {busy === "ready" ? "Working…" : "Mark Ready"}
          </button>
          <button disabled={!!busy} onClick={() => updateStatus("completed")} style={btnOk}>
            {busy === "completed" ? "Working…" : "Mark Completed"}
          </button>
          <button disabled={!!busy} onClick={() => updateStatus("cancelled")} style={btnDanger}>
            {busy === "cancelled" ? "Working…" : "Cancel Request"}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          If your API route uses different status names, the button may return an error — the page will still load.
        </div>
      </div>

      <div style={{ marginTop: 12, ...card }}>
        <h3 style={h3}>Files ({files.length})</h3>

        {files.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>No uploaded files found.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {files.map((f: any, idx: number) => {
              const label =
                f.file_name || f.filename || f.name || `File ${idx + 1}`;
              const url =
                f.signed_url || f.url || f.file_url || f.public_url || null;

              return (
                <div key={f.id || idx} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    {f.created_at ? new Date(f.created_at).toLocaleString() : "—"}
                  </div>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-block", marginTop: 8, fontSize: 13, textDecoration: "underline", color: "#111" }}
                    >
                      Open file
                    </a>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#b45309" }}>
                      File URL not available in response.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Raw request data (debug)</summary>
        <pre
          style={{
            marginTop: 10,
            background: "#0b1020",
            color: "#e5e7eb",
            padding: 12,
            borderRadius: 10,
            overflowX: "auto",
            fontSize: 12,
          }}
        >
{JSON.stringify(d, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6, fontSize: 14, color: "#374151" }}>
      <strong>{label}:</strong> {value}
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const v = String(value || "").toLowerCase();
  const color =
    v === "completed" || v === "ready" || v === "paid" || v === "done"
      ? "#16a34a"
      : v === "pending" || v === "received" || v === "in_progress"
      ? "#ca8a04"
      : v === "cancelled" || v === "denied"
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
        textTransform: "uppercase",
      }}
    >
      {value}
    </span>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 16,
  background: "#fff",
};

const h3: React.CSSProperties = {
  margin: "0 0 8px 0",
  fontSize: 16,
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnOk: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#16a34a",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#dc2626",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-block",
};

const btnGhostBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  cursor: "pointer",
};
