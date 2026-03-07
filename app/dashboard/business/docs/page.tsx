"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getStoredBusinessAccountId, isUuid, resolveBusinessAccountId } from "@/lib/businessSelection";

type DocsRequest = {
  id: string;
  request_code?: string | null;
  service_type?: string | null;
  title?: string | null;
  status?: string | null;
  paid?: boolean | null;
  quoted_total_cents?: number | null;
  total_cents?: number | null;
  created_at: string;
};

const STATUS_OPTIONS = ["", "draft", "submitted", "quoted", "in_progress", "completed"];

export default function BusinessDocsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<DocsRequest[]>([]);
  const [businessAccountId, setBusinessAccountId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.push("/login?next=%2Fdashboard%2Fbusiness%2Fdocs");
        return;
      }

      const id = resolveBusinessAccountId(new URLSearchParams(window.location.search).get("businessAccountId"));
      const selectedId = id || getStoredBusinessAccountId();
      if (!selectedId || !isUuid(selectedId)) {
        setError("Choose a business account first from the Business Portal page.");
        setRows([]);
        return;
      }

      setBusinessAccountId(selectedId);
      const qp = new URLSearchParams({ businessAccountId: selectedId });
      if (status) qp.set("status", status);

      const res = await fetch(`/api/business/docs-requests?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load docs requests");
      setRows((json?.requests || []) as DocsRequest[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load docs queue");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function duplicateTemplate(requestId: string) {
    if (!businessAccountId) return;
    setDuplicatingId(requestId);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Unauthorized");

      const res = await fetch("/api/business/docs-requests/duplicate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, businessAccountId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to duplicate");

      const newId = String(json?.requestId || "").trim();
      if (!newId) throw new Error("Duplicated request missing ID");
      router.push(`/docs/request?requestId=${encodeURIComponent(newId)}&businessAccountId=${encodeURIComponent(businessAccountId)}`);
    } catch (e: any) {
      setError(e?.message || "Failed to duplicate request");
    } finally {
      setDuplicatingId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const grouped = useMemo(() => {
    const buckets: Record<string, number> = { draft: 0, submitted: 0, quoted: 0, in_progress: 0, completed: 0 };
    for (const r of rows) {
      const key = String(r.status || "").trim();
      if (key in buckets) buckets[key] += 1;
    }
    return buckets;
  }, [rows]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <div style={panel}>
        <h1 style={{ margin: 0 }}>Business Docs Queue</h1>
        <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
          Queue view of draft/submitted/quoted/in-progress/completed docs requests for your selected business.
        </p>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/dashboard/business" style={btnGhost}>Back to Business Portal</Link>
          <Link href={businessAccountId ? `/docs/request?businessAccountId=${encodeURIComponent(businessAccountId)}` : "/docs/request"} style={btnPrimary}>New docs request</Link>
        </div>
      </div>

      <div style={{ ...panel, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Status</strong>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px" }}>
          {STATUS_OPTIONS.map((s) => <option key={s || "all"} value={s}>{s || "all"}</option>)}
        </select>
        <button onClick={load} style={btnGhostBtn}>Refresh</button>
        <div style={{ marginLeft: "auto", fontSize: 13, color: "#4b5563" }}>
          draft {grouped.draft} · submitted {grouped.submitted} · quoted {grouped.quoted} · in_progress {grouped.in_progress} · completed {grouped.completed}
        </div>
      </div>

      {loading && <div style={panel}>Loading…</div>}
      {error && <div style={{ ...panel, borderColor: "#fecaca", color: "#b91c1c" }}>{error}</div>}
      {!loading && !error && rows.length === 0 && <div style={panel}>No docs requests for this filter yet.</div>}

      {!loading && !error && rows.map((r) => {
        const amount = Number(r.total_cents ?? r.quoted_total_cents ?? 0);
        return (
          <div key={r.id} style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800 }}>{r.request_code || r.id.slice(0, 8)} · {r.title || "Docs request"}</div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>{new Date(r.created_at).toLocaleString()} · {(r.service_type || "—").replaceAll("_", " ")}</div>
              </div>
              <span style={{ border: "1px solid #d1d5db", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>{r.status || "—"}</span>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href={`/dashboard/docs/${encodeURIComponent(r.id)}`} style={btnGhost}>Open detail</Link>
              <Link href={`/docs/request?requestId=${encodeURIComponent(r.id)}&businessAccountId=${encodeURIComponent(businessAccountId || "")}`} style={btnGhost}>Continue draft</Link>
              {!r.paid && amount > 0 && <Link href={`/docs/checkout?requestId=${encodeURIComponent(r.id)}`} style={btnGhost}>Pay quoted job</Link>}
              <button onClick={() => duplicateTemplate(r.id)} disabled={duplicatingId === r.id} style={btnGhostBtn}>
                {duplicatingId === r.id ? "Duplicating…" : "Duplicate template"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const panel: React.CSSProperties = {
  marginTop: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#fff",
  padding: 14,
};

const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  textDecoration: "none",
  background: "#111827",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 12px",
  fontWeight: 800,
  fontSize: 14,
};

const btnGhost: React.CSSProperties = {
  display: "inline-block",
  textDecoration: "none",
  background: "#fff",
  color: "#111827",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: "10px 12px",
  fontWeight: 700,
  fontSize: 14,
};

const btnGhostBtn: React.CSSProperties = {
  background: "#fff",
  color: "#111827",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: "8px 12px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
