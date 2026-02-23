// app/admin/docs/requests/[requestId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocRequest = any;
type DocFile = any;
type DocEvent = any;

const STATUSES = [
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
];

export default function AdminDocRequestDetailPage() {
  const router = useRouter();
  const params = useParams<{ requestId: string }>();
  const requestId = String(params?.requestId || "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [request, setRequest] = useState<DocRequest | null>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [files, setFiles] = useState<DocFile[]>([]);
  const [events, setEvents] = useState<DocEvent[]>([]);

  // form states
  const [quoteDollars, setQuoteDollars] = useState("");
  const [dueAtLocal, setDueAtLocal] = useState("");
  const [noteText, setNoteText] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      throw new Error("Unauthorized");
    }
    return token;
  }

  function toLocalInputValue(iso?: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function load() {
    if (!requestId) return;
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();

      const res = await fetch(`/api/admin/docs/requests/${encodeURIComponent(requestId)}?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load request");

      const req = json?.request || null;
      setRequest(req);
      setCustomer(json?.customer || null);
      setFiles(json?.files || []);
      setEvents(json?.events || []);

      if (req) {
        setQuoteDollars(
          typeof req.quoted_total_cents === "number"
            ? (Number(req.quoted_total_cents) / 100).toFixed(2)
            : ""
        );
        setDueAtLocal(toLocalInputValue(req.due_at));
      }

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
  }, [requestId]);

  async function runAction(body: any, successMessage?: string) {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();

      const res = await fetch(`/api/admin/docs/requests/${encodeURIComponent(requestId)}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Request failed");

      if (successMessage) alert(successMessage);
      await load();
      return json;
    } catch (e: any) {
      setError(e?.message || "Action failed");
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function saveQuote() {
    const num = Number(quoteDollars);
    if (!Number.isFinite(num) || num < 0) {
      alert("Enter a valid quote amount.");
      return;
    }

    const amountCents = Math.round(num * 100);

    await runAction(
      {
        action: "save_quote",
        amountCents,
        dueAt: dueAtLocal ? new Date(dueAtLocal).toISOString() : null,
      },
      "Quote saved."
    );
  }

  async function setPaid(paid: boolean) {
    await runAction(
      { action: "set_paid", paid },
      paid ? "Marked paid." : "Marked unpaid."
    );
  }

  async function setStatus(status: string) {
    await runAction({ action: "set_status", status }, `Status updated to ${status}.`);
  }

  async function saveDueDateOnly() {
    await runAction(
      {
        action: "set_due_at",
        dueAt: dueAtLocal ? new Date(dueAtLocal).toISOString() : null,
      },
      "Due date updated."
    );
  }

  async function addNote() {
    const note = noteText.trim();
    if (!note) return;
    await runAction({ action: "add_note", note }, "Note added.");
    setNoteText("");
  }

  const derived = useMemo(() => {
    if (!request) return null;
    const status = String(request.status || "");
    const isFinal = status === "completed" || status === "cancelled";
    const quote = typeof request.quoted_total_cents === "number" ? request.quoted_total_cents / 100 : null;
    return { status, isFinal, quote };
  }, [request]);

  if (loading) return <p style={{ padding: 24 }}>Loading request…</p>;
  if (!request) return <p style={{ padding: 24 }}>Request not found.</p>;

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <div>
          <Link href="/admin/docs" style={styles.btnGhost}>← Back to Docs Queue</Link>
          <h1 style={{ margin: "12px 0 4px 0", fontSize: 28 }}>
            {request.title || "Docs Request"}
          </h1>
          <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
            <div><strong>Request Code:</strong> {request.request_code || "—"}</div>
            <div><strong>Request ID:</strong> {request.id}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Badge value={request.status || "—"} />
          <Badge value={request.service_type || "—"} tone="neutral" />
          <button onClick={load} style={styles.btnPrimary} disabled={saving}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
        </div>
      )}

      <div style={styles.grid}>
        {/* LEFT COLUMN */}
        <div style={{ display: "grid", gap: 12 }}>
          <section style={styles.card}>
            <h2 style={styles.h2}>Customer & Request Info</h2>
            <div style={styles.kv}>
              <div><strong>Customer email:</strong> {customer?.email || "—"}</div>
              <div><strong>Phone:</strong> {request.phone || "—"}</div>
              <div><strong>Delivery method:</strong> {request.delivery_method || "—"}</div>
              <div><strong>Paid:</strong> {request.paid ? "Yes" : "No"}</div>
              <div>
                <strong>Quote:</strong>{" "}
                {typeof request.quoted_total_cents === "number"
                  ? `$${(Number(request.quoted_total_cents) / 100).toFixed(2)}`
                  : "—"}
              </div>
              <div><strong>Due:</strong> {request.due_at ? new Date(request.due_at).toLocaleString() : "—"}</div>
              <div><strong>Created:</strong> {request.created_at ? new Date(request.created_at).toLocaleString() : "—"}</div>
              <div><strong>Updated:</strong> {request.updated_at ? new Date(request.updated_at).toLocaleString() : "—"}</div>
            </div>

            {request.description && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>Description</div>
                <div style={{ whiteSpace: "pre-wrap", color: "#374151", fontSize: 14, lineHeight: 1.6 }}>
                  {request.description}
                </div>
              </div>
            )}

            {customer?.email && (
              <div style={{ marginTop: 12 }}>
                <a
                  href={`mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(`Couranr Docs Request ${request.request_code || request.id}`)}`}
                  style={styles.btnGhost}
                >
                  Email Customer
                </a>
              </div>
            )}
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>Files</h2>
            {files.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280" }}>No files uploaded yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {files.map((f, idx) => {
                  const href = f.signed_url || f.direct_url || null;
                  return (
                    <div key={f.id || idx} style={styles.fileRow}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>
                          {f.display_name || f.file_name || f.name || `File ${idx + 1}`}
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                          {typeof f.size_bytes === "number" ? `${Math.round(f.size_bytes / 1024)} KB` : "Size —"}{" "}
                          • {f.mime_type || f.content_type || "file"}{" "}
                          • {f.created_at ? new Date(f.created_at).toLocaleString() : ""}
                        </div>
                      </div>

                      {href ? (
                        <a href={href} target="_blank" style={styles.btnPrimary}>
                          Open
                        </a>
                      ) : (
                        <span style={{ ...styles.btnGhost, opacity: 0.6, pointerEvents: "none" }}>
                          No URL
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>Timeline / Events</h2>
            {events.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280" }}>No events yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {events
                  .slice()
                  .reverse()
                  .map((ev, idx) => (
                    <div key={ev.id || idx} style={styles.eventRow}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{ev.event_type || "event"}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                        {ev.created_at ? new Date(ev.created_at).toLocaleString() : "—"} • {ev.actor_role || "system"}
                      </div>
                      {ev.event_payload && (
                        <pre style={styles.eventPayload}>{safePretty(ev.event_payload)}</pre>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <section style={styles.card}>
            <h2 style={styles.h2}>Workflow Controls</h2>

            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Quick status changes</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {STATUSES.map((s) => (
                <button
                  key={s}
                  disabled={saving || request.status === s}
                  onClick={() => setStatus(s)}
                  style={{
                    ...styles.btnGhostBtn,
                    borderColor: request.status === s ? "#111827" : "#d1d5db",
                    fontWeight: request.status === s ? 900 : 700,
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            <div style={styles.divider} />

            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Suggested path</div>
            <div style={{ display: "grid", gap: 8 }}>
              <button disabled={saving} onClick={() => setStatus("intake_review")} style={styles.btnGhostBtn}>
                Intake Review
              </button>
              <button disabled={saving} onClick={() => setStatus("awaiting_quote")} style={styles.btnGhostBtn}>
                Awaiting Quote
              </button>
              <button disabled={saving} onClick={saveQuote} style={styles.btnPrimary}>
                Save Quote (and move to quoted)
              </button>
              <button disabled={saving} onClick={() => setStatus("awaiting_payment")} style={styles.btnGhostBtn}>
                Awaiting Payment
              </button>
              <button disabled={saving} onClick={() => setPaid(true)} style={styles.btnOk}>
                Mark Paid
              </button>
              <button disabled={saving} onClick={() => setStatus("in_progress")} style={styles.btnGhostBtn}>
                In Progress
              </button>
              <button disabled={saving} onClick={() => setStatus("ready")} style={styles.btnGhostBtn}>
                Mark Ready
              </button>
              <button disabled={saving} onClick={() => setStatus("out_for_delivery")} style={styles.btnGhostBtn}>
                Out for Delivery
              </button>
              <button disabled={saving} onClick={() => setStatus("completed")} style={styles.btnOk}>
                Complete Request
              </button>
              <button
                disabled={saving || derived?.isFinal}
                onClick={() => {
                  if (window.confirm("Cancel this docs request?")) setStatus("cancelled");
                }}
                style={styles.btnDanger}
              >
                Cancel Request
              </button>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>Quote & Due Date</h2>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={styles.label}>Quote amount (USD)</div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quoteDollars}
                  onChange={(e) => setQuoteDollars(e.target.value)}
                  style={styles.input}
                  placeholder="0.00"
                />
              </div>

              <div>
                <div style={styles.label}>Due date / time</div>
                <input
                  type="datetime-local"
                  value={dueAtLocal}
                  onChange={(e) => setDueAtLocal(e.target.value)}
                  style={styles.input}
                />
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button disabled={saving} onClick={saveQuote} style={styles.btnPrimary}>
                  Save Quote
                </button>
                <button disabled={saving} onClick={saveDueDateOnly} style={styles.btnGhostBtn}>
                  Save Due Date
                </button>
              </div>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>Payment</h2>
            <div style={{ fontSize: 14, color: "#374151", marginBottom: 10 }}>
              Current payment status:{" "}
              <strong>{request.paid ? "Paid" : "Not paid"}</strong>
              {request.paid_at ? ` • ${new Date(request.paid_at).toLocaleString()}` : ""}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={saving || !!request.paid} onClick={() => setPaid(true)} style={styles.btnOk}>
                Mark Paid
              </button>
              <button disabled={saving || !request.paid} onClick={() => setPaid(false)} style={styles.btnGhostBtn}>
                Mark Unpaid
              </button>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>Internal Notes</h2>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={4}
              placeholder="Add an internal note for your timeline/audit..."
              style={styles.textarea}
            />
            <div style={{ marginTop: 8 }}>
              <button disabled={saving || !noteText.trim()} onClick={addNote} style={styles.btnPrimary}>
                Add Note
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function safePretty(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
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
    maxWidth: 1280,
    margin: "0 auto",
    padding: 24,
    fontFamily: "sans-serif",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.9fr)",
    gap: 12,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
  },
  h2: {
    margin: "0 0 10px 0",
    fontSize: 18,
    fontWeight: 900,
  },
  kv: {
    fontSize: 14,
    lineHeight: 1.7,
    color: "#374151",
  },
  fileRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    border: "1px solid #f1f5f9",
    borderRadius: 10,
    padding: 10,
  },
  eventRow: {
    border: "1px solid #f1f5f9",
    borderRadius: 10,
    padding: 10,
    background: "#fcfcfd",
  },
  eventPayload: {
    marginTop: 8,
    marginBottom: 0,
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: 8,
    fontSize: 11,
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    color: "#334155",
  },
  divider: {
    height: 1,
    background: "#e5e7eb",
    margin: "12px 0",
  },
  label: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
    fontWeight: 700,
  },
  input: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
  },
  textarea: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
    resize: "vertical",
  },
  errorBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #fecaca",
    background: "#fff",
  },

  btnPrimary: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
    textAlign: "center",
  },
  btnOk: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#16a34a",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnDanger: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#dc2626",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnGhost: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    fontWeight: 900,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  },
  btnGhostBtn: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    fontWeight: 700,
    cursor: "pointer",
  },
};
