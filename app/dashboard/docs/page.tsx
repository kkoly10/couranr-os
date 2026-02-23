// app/dashboard/docs/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocRequest = {
  id: string;
  request_code: string;
  service_type: string;
  title: string;
  status: string;
  description: string | null;
  delivery_method: string | null;
  quoted_total_cents: number | null;
  paid: boolean;
  due_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "unauth" }
  | { kind: "ready"; requests: DocRequest[] }
  | { kind: "error"; message: string };

export default function DocsDashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session?.access_token) {
        setState({ kind: "unauth" });
        router.push("/login?next=/dashboard/docs");
        return;
      }

      await load(session.access_token);
    }

    boot();
    return () => {
      mounted = false;
    };
  }, [router]);

  async function load(token?: string) {
    try {
      let accessToken = token;
      if (!accessToken) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        accessToken = session?.access_token || "";
      }

      if (!accessToken) {
        setState({ kind: "unauth" });
        router.push("/login?next=/dashboard/docs");
        return;
      }

      const res = await fetch(`/api/docs/my-requests?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load docs requests");

      setState({ kind: "ready", requests: data?.requests || [] });
      router.refresh();
    } catch (e: any) {
      setState({ kind: "error", message: e?.message || "Failed to load docs dashboard" });
    }
  }

  const summary = useMemo(() => {
    if (state.kind !== "ready") return null;

    const total = state.requests.length;
    const open = state.requests.filter((r) =>
      ["submitted", "intake_review", "awaiting_quote", "quoted", "awaiting_payment", "paid", "in_progress", "ready", "out_for_delivery"].includes(String(r.status || "").toLowerCase())
    ).length;

    const completed = state.requests.filter((r) => String(r.status).toLowerCase() === "completed").length;
    const cancelled = state.requests.filter((r) => String(r.status).toLowerCase() === "cancelled").length;

    return { total, open, completed, cancelled };
  }, [state]);

  if (state.kind === "loading") return <p style={{ padding: 24 }}>Loading docs dashboard…</p>;
  if (state.kind === "unauth") return <p style={{ padding: 24 }}>Redirecting to login…</p>;
  if (state.kind === "error") {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
        <h1 style={{ margin: 0 }}>Docs Dashboard</h1>
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {state.message}
        </div>
        <button onClick={() => load()} style={{ ...btnPrimary, marginTop: 14 }}>
          Retry
        </button>
      </div>
    );
  }

  const requests = state.requests;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Docs Dashboard</h1>
          <p style={{ color: "#555", marginTop: 6 }}>
            Track printing, typing, data entry, and document support requests.
          </p>

          {!!summary && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip label={`Total: ${summary.total}`} />
              <Chip label={`Open: ${summary.open}`} />
              <Chip label={`Completed: ${summary.completed}`} />
              <Chip label={`Cancelled: ${summary.cancelled}`} />
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* Step 4 intake page will be /docs/request. For now, no broken link. */}
          <Link href="/docs" style={btnGhostLink}>
            Docs Services
          </Link>

          <a
            href="mailto:couranr@couranrauto.com?subject=Couranr%20Docs%20Request"
            style={btnGhostLink}
          >
            Email Request
          </a>

          <button onClick={() => load()} style={btnPrimary}>
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 14,
          borderRadius: 12,
          border: "1px solid #fde68a",
          background: "#fffbeb",
          color: "#92400e",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <strong>Important:</strong> Couranr Docs provides clerical/administrative assistance only (printing,
        typing, organizing, data entry, and appointment prep support). This is not legal advice, not a law
        firm, and no approval/outcome is guaranteed.
      </div>

      {requests.length === 0 ? (
        <div
          style={{
            marginTop: 18,
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            background: "#fff",
            padding: 18,
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>No Docs requests yet</h2>
          <p style={{ color: "#555", marginTop: 0 }}>
            Your Docs requests will appear here once submitted.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <Link href="/docs" style={btnPrimaryLink}>
              View Docs Services
            </Link>
            <a
              href="mailto:couranr@couranrauto.com?subject=Couranr%20Docs%20Request"
              style={btnGhostLink}
            >
              Email a request
            </a>
          </div>

          <p style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>
            Next step in build order: we’ll add the customer intake page at <strong>/docs/request</strong>.
          </p>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {requests.map((r) => (
            <div
              key={r.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                background: "#fff",
                padding: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15 }}>{r.title || "Docs Request"}</strong>
                    <Badge value={r.status} />
                    <Badge value={labelServiceType(r.service_type)} tone="neutral" />
                  </div>

                  <div style={{ marginTop: 6, fontSize: 13, color: "#4b5563" }}>
                    <strong>Code:</strong> {r.request_code}
                  </div>

                  {r.description && (
                    <div style={{ marginTop: 8, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                      {r.description}
                    </div>
                  )}

                  <div style={{ marginTop: 10, fontSize: 13, color: "#374151", lineHeight: 1.65 }}>
                    <div><strong>Delivery method:</strong> {r.delivery_method || "—"}</div>
                    <div><strong>Files uploaded:</strong> {r.file_count}</div>
                    <div><strong>Paid:</strong> {r.paid ? "Yes" : "No"}</div>

                    {typeof r.quoted_total_cents === "number" && (
                      <div>
                        <strong>Quoted total:</strong> ${(r.quoted_total_cents / 100).toFixed(2)}
                      </div>
                    )}

                    {r.due_at && (
                      <div>
                        <strong>Due:</strong> {new Date(r.due_at).toLocaleString()}
                      </div>
                    )}

                    {r.completed_at && (
                      <div>
                        <strong>Completed:</strong> {new Date(r.completed_at).toLocaleString()}
                      </div>
                    )}

                    {r.cancelled_at && (
                      <div>
                        <strong>Cancelled:</strong> {new Date(r.cancelled_at).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                    Created: {new Date(r.created_at).toLocaleString()} • Updated: {new Date(r.updated_at).toLocaleString()}
                  </div>
                </div>

                <div style={{ minWidth: 220, display: "grid", gap: 8, alignContent: "start" }}>
                  {/* Detail page is step 7 in your saved order, so no broken link yet */}
                  <button disabled style={{ ...btnGhostBtn, opacity: 0.55, cursor: "not-allowed" }}>
                    Request details (coming next)
                  </button>

                  {r.status === "quoted" && !r.paid && (
                    <div
                      style={{
                        border: "1px solid #bfdbfe",
                        background: "#eff6ff",
                        color: "#1e3a8a",
                        borderRadius: 12,
                        padding: 10,
                        fontSize: 12,
                        lineHeight: 1.4,
                      }}
                    >
                      Quote ready. Payment portal step will be added in the next Docs pages.
                    </div>
                  )}

                  {r.status === "ready" && (
                    <div
                      style={{
                        border: "1px solid #bbf7d0",
                        background: "#ecfdf5",
                        color: "#166534",
                        borderRadius: 12,
                        padding: 10,
                        fontSize: 12,
                        lineHeight: 1.4,
                      }}
                    >
                      Your request is marked ready. Pickup/delivery instructions will appear in the full request page.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelServiceType(v: string) {
  const map: Record<string, string> = {
    printing_delivery: "Printing + Delivery",
    printing_pickup: "Printing + Pickup",
    scan_email: "Scan to Email",
    typing: "Typing",
    resume_review: "Resume Review",
    dmv_prep_admin: "DMV Prep",
    immigration_prep_admin: "Immigration Prep",
    data_entry: "Data Entry",
    general_admin_help: "Admin Help",
  };
  return map[v] || v || "Service";
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
        fontWeight: 900,
      }}
    >
      {label}
    </span>
  );
}

function Badge({ value, tone }: { value: string; tone?: "neutral" | "status" }) {
  const v = String(value || "").toLowerCase();

  let color = "#374151";
  if (tone !== "neutral") {
    color =
      v === "completed" || v === "paid" || v === "ready"
        ? "#16a34a"
        : v === "submitted" || v === "intake_review" || v === "awaiting_quote" || v === "quoted" || v === "awaiting_payment"
        ? "#ca8a04"
        : v === "cancelled"
        ? "#dc2626"
        : v === "in_progress" || v === "out_for_delivery"
        ? "#2563eb"
        : "#374151";
  }

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

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnPrimaryLink: React.CSSProperties = {
  ...btnPrimary,
  textDecoration: "none",
  display: "inline-block",
};

const btnGhostLink: React.CSSProperties = {
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
};