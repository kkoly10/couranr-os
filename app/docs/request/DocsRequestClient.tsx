"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocFile = {
  id: string;
  file_name?: string;
  display_name?: string;
  mime_type?: string;
  size_bytes?: number;
  created_at?: string;
  signed_url?: string | null;
};

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
};

const SERVICE_OPTIONS = [
  { value: "print_scan_delivery", label: "Print / Scan / Delivery Help" },
  { value: "data_entry", label: "Business Data Entry Help" },
  { value: "dmv_prep", label: "DMV Document Prep (Administrative Help)" },
  { value: "immigration_clerical", label: "Immigration Packet Prep (Administrative Help)" },
  { value: "resume_typing", label: "Resume / Typing / General Document Help" },
];

export default function DocsRequestClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [bootingDraft, setBootingDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [request, setRequest] = useState<DocRequest | null>(null);
  const [files, setFiles] = useState<DocFile[]>([]);

  const [serviceType, setServiceType] = useState("print_scan_delivery");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("delivery");
  const [phone, setPhone] = useState("");

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const requestId = sp.get("requestId") || "";

  const serviceHelp = useMemo(() => {
    const map: Record<string, string> = {
      print_scan_delivery:
        "Use this for printing, scanning, packet assembly, local delivery/pickup, or email-ready PDFs. Put your exact print/scan instructions in the description.",
      data_entry:
        "Use this for clerical backlog work, spreadsheet entry, document typing, data transfer, and record organization.",
      dmv_prep:
        "Administrative help only (no legal advice, not a government agency). We can help organize forms, checklists, and document readiness.",
      immigration_clerical:
        "Administrative packet prep support only (no legal advice). We can help type/organize documents and prepare submission-ready packets based on your info.",
      resume_typing:
        "Use this for resume formatting, typing handwritten notes, document cleanup, and general typing/document help.",
    };
    return map[serviceType] || "";
  }, [serviceType]);

  async function getTokenOrRedirect() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      const next = window.location.pathname + window.location.search;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      throw new Error("Unauthorized");
    }
    return token;
  }

  async function createDraft() {
    setBootingDraft(true);
    setError(null);

    try {
      const token = await getTokenOrRedirect();

      const res = await fetch("/api/docs/create-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serviceType: "print_scan_delivery",
          title: "Docs Request",
          deliveryMethod: "delivery",
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to create draft");

      const req = (json.request || {}) as DocRequest;
      if (!req?.id) throw new Error("Draft created but request ID is missing");

      router.replace(`/docs/request?requestId=${encodeURIComponent(req.id)}`);
    } catch (e: any) {
      setError(e?.message || "Failed to create draft");
    } finally {
      setBootingDraft(false);
    }
  }

  async function loadRequest(id: string) {
    setLoading(true);
    setError(null);

    try {
      const token = await getTokenOrRedirect();

      const res = await fetch(
        `/api/docs/my-request-detail?requestId=${encodeURIComponent(id)}&t=${Date.now()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load request");

      const req = (json.request || {}) as DocRequest;
      const fs = (json.files || []) as DocFile[];

      setRequest(req);
      setFiles(fs);

      setServiceType(req.service_type || "print_scan_delivery");
      setTitle(req.title || "");
      setDescription(req.description || "");
      setDeliveryMethod(req.delivery_method || "delivery");
      setPhone(req.phone || "");
    } catch (e: any) {
      setError(e?.message || "Failed to load request");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!requestId) {
      setLoading(false);
      createDraft();
      return;
    }
    loadRequest(requestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  async function saveDraft(opts?: { silent?: boolean }) {
    if (!request) return false;

    setSaving(true);
    setError(null);

    try {
      const token = await getTokenOrRedirect();

      const res = await fetch("/api/docs/save-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          requestId: request.id,
          serviceType,
          title,
          description,
          deliveryMethod,
          phone,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save");

      if (json?.request) {
        setRequest(json.request as DocRequest);
      }

      if (!opts?.silent) {
        window.alert("Saved.");
      }
      return true;
    } catch (e: any) {
      setError(e?.message || "Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function uploadSelected() {
    if (!request) return;
    if (!selectedFiles.length) {
      setError("Select at least one file.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const token = await getTokenOrRedirect();

      for (const f of selectedFiles) {
        const fd = new FormData();
        fd.append("requestId", request.id);
        fd.append("file", f);

        const res = await fetch("/api/docs/upload-file", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `Upload failed for ${f.name}`);
      }

      setSelectedFiles([]);
      await loadRequest(request.id);
      window.alert("File(s) uploaded.");
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submitRequest() {
    if (!request) return;

    if (!title.trim()) {
      setError("Please add a title.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const saved = await saveDraft({ silent: true });
      if (!saved) {
        throw new Error("Please fix the save issue before submitting.");
      }

      const token = await getTokenOrRedirect();

      const res = await fetch("/api/docs/submit-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          requestId: request.id,
          serviceType,
          title,
          description,
          deliveryMethod,
          phone,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to submit");

      const finalReq = (json.request || {}) as DocRequest;
      const finalId = finalReq.id || json.requestId || request.id;
      const finalCode = finalReq.request_code || request.request_code || "";

      router.push(
        `/docs/success?requestId=${encodeURIComponent(finalId)}&code=${encodeURIComponent(
          String(finalCode || "")
        )}`
      );
    } catch (e: any) {
      setError(e?.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (bootingDraft) return <p style={{ padding: 24 }}>Creating your Docs request…</p>;
  if (loading) return <p style={{ padding: 24 }}>Loading Docs request…</p>;
  if (!request) return <p style={{ padding: 24 }}>Unable to load request.</p>;

  return (
    <div style={styles.container}>
      <div style={styles.top}>
        <div>
          <h1 style={styles.h1}>Couranr Docs Request</h1>
          <p style={styles.sub}>
            Upload files and tell us what you need. We’ll review it and send a quote if needed.
          </p>
          <div style={{ marginTop: 8, fontSize: 13, color: "#374151" }}>
            <strong>Request Code:</strong> {request.request_code || "—"}{" "}
            <span style={{ marginLeft: 10 }}>
              <Badge value={request.status || "draft"} />
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/dashboard/docs" style={styles.btnGhost}>
            My Docs Dashboard
          </Link>
          <button onClick={() => loadRequest(request.id)} style={styles.btnGhost}>
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
        <section style={styles.card}>
          <h2 style={styles.h2}>1) Request Details</h2>

          <div style={styles.label}>Service Type</div>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            style={styles.input}
          >
            {SERVICE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <div style={styles.helpBox}>{serviceHelp}</div>

          <div style={styles.label}>Title</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={styles.input}
            placeholder="Example: Print and deliver 35-page packet"
          />

          <div style={styles.label}>Description / Instructions</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            style={styles.textarea}
            placeholder="Tell us exactly what you need (quantity, color/B&W, single/double sided, deadline, etc.)"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={styles.label}>Delivery Method</div>
              <select
                value={deliveryMethod}
                onChange={(e) => setDeliveryMethod(e.target.value)}
                style={styles.input}
              >
                <option value="delivery">Delivery</option>
                <option value="pickup">Pickup</option>
                <option value="email">Email</option>
                <option value="meetup">Meetup</option>
              </select>
            </div>

            <div>
              <div style={styles.label}>Phone</div>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={styles.input}
                placeholder="(optional)"
              />
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => saveDraft()} disabled={saving || submitting} style={styles.btnPrimary}>
              {saving ? "Saving…" : "Save Draft"}
            </button>
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>2) Upload Files</h2>

          <div style={styles.uploadBox}>
            <input
              type="file"
              multiple
              onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
            />
            {selectedFiles.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                Selected: <strong>{selectedFiles.length}</strong> file(s)
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <button
                onClick={uploadSelected}
                disabled={uploading || !selectedFiles.length}
                style={styles.btnPrimary}
              >
                {uploading ? "Uploading…" : "Upload Files"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Uploaded Files</div>
            {files.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280" }}>No files uploaded yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {files.map((f, idx) => (
                  <div key={f.id || idx} style={styles.fileRow}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {f.display_name || f.file_name || `File ${idx + 1}`}
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {typeof f.size_bytes === "number"
                          ? `${Math.round(f.size_bytes / 1024)} KB`
                          : "Size —"}{" "}
                        • {f.mime_type || "file"}
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
          </div>
        </section>
      </div>

      <section style={{ ...styles.card, marginTop: 12 }}>
        <h2 style={styles.h2}>3) Submit Request</h2>
        <p style={{ marginTop: 0, color: "#374151", lineHeight: 1.6 }}>
          Once submitted, your request moves into admin review. We may send a quote depending on the service type and scope.
        </p>

        <div style={styles.disclaimer}>
          <strong>Important:</strong> DMV / immigration support here is administrative document-prep assistance only.
          We do not provide legal advice and are not a government agency.
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={submitRequest}
            disabled={submitting || saving || uploading}
            style={styles.btnPrimary}
          >
            {submitting ? "Submitting…" : "Submit Docs Request"}
          </button>
          <button onClick={() => saveDraft()} disabled={saving || submitting} style={styles.btnGhost}>
            Save First
          </button>
        </div>
      </section>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const v = String(value || "").toLowerCase();
  const color =
    v === "completed" || v === "paid"
      ? "#16a34a"
      : v === "submitted" || v === "draft"
      ? "#ca8a04"
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

const styles: Record<string, any> = {
  container: { maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "sans-serif" },
  top: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  h1: { margin: 0, fontSize: 28, fontWeight: 900 },
  sub: { marginTop: 6, marginBottom: 0, color: "#555" },
  grid: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
    gap: 12,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
  },
  h2: { margin: "0 0 10px 0", fontSize: 18, fontWeight: 900 },
  label: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
    marginTop: 8,
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
  helpBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#f8fafc",
    fontSize: 13,
    color: "#334155",
    lineHeight: 1.5,
  },
  uploadBox: {
    border: "1px dashed #cbd5e1",
    borderRadius: 12,
    padding: 12,
    background: "#fcfcfd",
  },
  fileRow: {
    border: "1px solid #f1f5f9",
    borderRadius: 10,
    padding: 10,
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
  },
  disclaimer: {
    padding: 10,
    borderRadius: 10,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    fontSize: 13,
    lineHeight: 1.5,
  },
  errorBox: {
    marginTop: 12,
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
};
