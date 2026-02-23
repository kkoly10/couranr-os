// app/admin/docs/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocRequest = {
  id: string;
  user_id: string;
  request_code: string;
  service_type: string;
  title: string;
  status: string;
  description: string | null;
  delivery_method: string | null;
  phone: string | null;
  quoted_total_cents: number | null;
  paid: boolean;
  paid_at: string | null;
  due_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  customer_email: string | null;
  file_count: number;
};

const STATUS_OPTIONS = [
  "all",
  "draft",
  "submitted",
  "intake_review",
  "awaiting_quote",
  "quoted",
  "awaiting_payment",
  "paid",
  "in_progress",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;

export default function AdminDocsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent("/admin/docs")}`);
      throw new Error("Unauthorized");
    }
    return token;
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();

      const qs = new URLSearchParams();
      qs.set("t", String(Date.now()));
      if (statusFilter) qs.set("status", statusFilter);
      if (searchQuery.trim()) qs.set("q", searchQuery.trim());

      const res = await fetch(`/api/admin/docs/requests?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load docs requests");

      setRequests(json?.requests || []);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchQuery]);

  const stats = useMemo(() => {
    const total = requests.length;
    const open = requests.filter((r) =>
      [
        "submitted",
        "intake_review",
        "awaiting_quote",
        "quoted",
        "awaiting_payment",
        "paid",
        "in_progress",
        "ready",
        "out_for_delivery",
      ].includes(String(r.status || "").toLowerCase())
    ).length;

    const completed = requests.filter((r) => r.status === "completed").length;
    const cancelled = requests.filter((r) => r.status === "cancelled").length;
    const paid = requests.filter((r) => !!r.paid).length;

    return { total, open, completed, cancelled, paid };
  }, [requests]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerWrap}>
        <div>
          <h1 style={styles.h1}>Admin — Docs</h1>
          <p style={styles.sub}>
            Manage printing, typing, data entry, DMV/immigration prep support, and other document requests.
          </p>

          <div style={styles.chipRow}>
            <Chip label={`Visible: ${stats.total}`} />
            <Chip label={`Open: ${stats.open}`} />
            <Chip label={`Paid: ${stats.paid}`} />
            <Chip label={`Completed: ${stats.completed}`} />
            <Chip label={`Cancelled: ${stats.cancelled}`} />
          </div>
        </div>

        <div style={styles.headerActions}>
          <Link href="/admin" style={styles.btnGhost}>
            Back to Admin
          </Link>
          <button onClick={load} style={styles.btnPrimary}>
            Refresh
          </button>
        </div>
      </div>

      <div style={styles.notice}>
        <strong>Docs workflow:</strong> customer submits request → admin reviews → quote/payment → work in progress → ready/delivery → completed.
      </div>

      <div style={styles.filtersCard}>
        <div style={styles.filtersGrid}>
          <div>
            <div style={styles.label}>Status</div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={styles.select}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <form onSubmit={onSearchSubmit} style={{ display: "grid", gap: 6 }}>
            <div style={styles.label}>Search</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Request code, title, description"
                style={styles.input}
              />
              <button type="submit" style={styles.btnPrimary}>
                Search
              </button>
            </div>
          </form>
        </div>

        {searchQuery && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Search: <strong>{searchQuery}</strong>{" "}
            <button
              onClick={() => {
                setSearchInput("");
                setSearchQuery("");
              }}
              style={styles.inlineClearBtn}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {loading && <p style={{ paddingTop: 12 }}>Loading docs requests…</p>}

      {error && (
        <div style={styles.errorBox}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
        </div>
      )}

      {!loading && requests.length === 0 && (
        <div style={styles.card}>
          <p style={{ margin: 0 }}>No Docs requests found for the current filter.</p>
        </div>
      )}

      {!loading && requests.length > 0 && (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {requests.map((r) => (
            <div key={r.id} style={styles.card}>
              <div style={styles.rowTop}>
                <div style={{ flex: 1, minWidth: 300 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <strong style={{ fontSize: 15 }}>{r.title || "Docs Request"}</strong>
                    <Badge value={r.status} />
                    <Badge value={formatServiceType(r.service_type)} tone="neutral" />
                  </div>

                  <div style={{ marginTop: 6, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
                    <div><strong>Request code:</strong> {r.request_code}</div>
                    <div><strong>Request ID:</strong> {r.id}</div>
                    <div><strong>Customer email:</strong> {r.customer_email || "—"}</div>
                    <div><strong>Phone:</strong> {r.phone || "—"}</div>
                    <div><strong>Delivery method:</strong> {r.delivery_method || "—"}</div>
                    <div><strong>Files uploaded:</strong> {r.file_count}</div>
                    <div><strong>Paid:</strong> {r.paid ? "Yes" : "No"}</div>

                    {typeof r.quoted_total_cents === "number" && (
                      <div>
                        <strong>Quote:</strong> ${(r.quoted_total_cents / 100).toFixed(2)}
                      </div>
                    )}

                    {r.description && (
                      <div style={{ marginTop: 6 }}>
                        <strong>Description:</strong> {r.description}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                    Created: {new Date(r.created_at).toLocaleString()}
                    {r.submitted_at ? ` • Submitted: ${new Date(r.submitted_at).toLocaleString()}` : ""}
                    {r.due_at ? ` • Due: ${new Date(r.due_at).toLocaleString()}` : ""}
                    {r.completed_at ? ` • Completed: ${new Date(r.completed_at).toLocaleString()}` : ""}
                    {r.cancelled_at ? ` • Cancelled: ${new Date(r.cancelled_at).toLocaleString()}` : ""}
                  </div>
                </div>

                <div style={styles.actionCol}>
                  <Link href={`/admin/docs/requests/${r.id}`} style={styles.btnPrimary}>
                    Open Request
                  </Link>

                  {r.customer_email && (
                    <a
                      href={`mailto:${encodeURIComponent(r.customer_email)}?subject=${encodeURIComponent(`Couranr Docs Request ${r.request_code}`)}`}
                      style={styles.btnGhost}
                    >
                      Email Customer
                    </a>
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

function formatServiceType(v: string) {
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
  return <span style={styles.chip}>{label}</span>;
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
        : v === "in_progress" || v === "out_for_delivery"
        ? "#2563eb"
        : v === "cancelled"
        ? "#dc2626"
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

const styles: Record<string, any> = {
  container: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: 24,
    fontFamily: "sans-serif",
  },
  headerWrap: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  h1: {
    fontSize: 28,
    margin: 0,
    fontWeight: 900,
  },
  sub: {
    color: "#555",
    marginTop: 6,
    marginBottom: 0,
  },
  chipRow: {
    marginTop: 10,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  chip: {
    padding: "6px 10px",
    borderRadius: 999,
    background: "#f3f4f6",
    color: "#111827",
    fontSize: 12,
    fontWeight: 900,
  },
  headerActions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  notice: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    fontSize: 13,
    lineHeight: 1.5,
  },
  filtersCard: {
    marginTop: 14,
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
  },
  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: 12,
    alignItems: "end",
  },
  label: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
    fontWeight: 700,
  },
  select: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
  },
  input: {
    flex: 1,
    minWidth: 180,
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
  },
  inlineClearBtn: {
    border: "none",
    background: "none",
    color: "#2563eb",
    textDecoration: "underline",
    cursor: "pointer",
    fontSize: 12,
    padding: 0,
    marginLeft: 6,
  },
  errorBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #fecaca",
    background: "#fff",
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 16,
    background: "#fff",
  },
  rowTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  actionCol: {
    minWidth: 220,
    display: "grid",
    gap: 8,
    alignContent: "start",
  },
  btnPrimary: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-block",
    textAlign: "center",
  },
  btnGhost: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-block",
    textAlign: "center",
  },
};
