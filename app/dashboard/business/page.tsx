"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getStoredBusinessAccountId, isUuid, setStoredBusinessAccountId } from "@/lib/businessSelection";

type BillingSummary = {
  monthStart: string;
  deliveriesCount: number;
  docsCount: number;
  billedCents: number;
  unpaidCents: number;
};

type BusinessAccount = {
  id: string;
  name: string | null;
  billing_email: string | null;
  status: string | null;
  timezone: string | null;
  role: string;
};

export default function BusinessDashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    const fromQs = typeof window !== "undefined"
      ? String(new URLSearchParams(window.location.search).get("businessAccountId") || "").trim()
      : "";
    const current = isUuid(fromQs) ? fromQs : getStoredBusinessAccountId();
    setSelectedId(current);
  }, []);

  async function load() {
    setLoading(true);
    setError(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      router.push("/login?next=%2Fdashboard%2Fbusiness");
      return;
    }

    const res = await fetch("/api/business/my-accounts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json?.error || "Failed to load business accounts");
      setAccounts([]);
      setLoading(false);
      return;
    }

    const list = (json?.accounts || []) as BusinessAccount[];
    setAccounts(list);

    if (list.length > 0) {
      const ids = new Set(list.map((a) => a.id));
      const current = selectedId && ids.has(selectedId) ? selectedId : ids.has(getStoredBusinessAccountId() || "") ? getStoredBusinessAccountId() : list[0].id;
      setSelectedId(current || null);
      setStoredBusinessAccountId(current || null);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function loadSummary() {
      if (!selectedId) {
        setSummary(null);
        return;
      }

      try {
        setSummaryError(null);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const res = await fetch(`/api/business/billing-summary?businessAccountId=${encodeURIComponent(selectedId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load billing summary");
        setSummary((json?.summary || null) as BillingSummary | null);
      } catch (e: any) {
        setSummaryError(e?.message || "Failed to load billing summary");
        setSummary(null);
      }
    }

    loadSummary();
  }, [selectedId]);

  const selected = useMemo(() => accounts.find((a) => a.id === selectedId) || null, [accounts, selectedId]);

  function onSelect(v: string) {
    const id = isUuid(v) ? v : null;
    setSelectedId(id);
    setStoredBusinessAccountId(id);
  }

  const courierHref = selectedId ? `/courier/quote?businessAccountId=${encodeURIComponent(selectedId)}` : "/courier/quote";
  const docsHref = selectedId ? `/docs/request?businessAccountId=${encodeURIComponent(selectedId)}` : "/docs/request";
  const deliveriesOpsHref = selectedId
    ? `/dashboard/business/deliveries?businessAccountId=${encodeURIComponent(selectedId)}`
    : "/dashboard/business/deliveries";
  const docsOpsHref = selectedId
    ? `/dashboard/business/docs?businessAccountId=${encodeURIComponent(selectedId)}`
    : "/dashboard/business/docs";

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: 20 }}>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, background: "#fff", padding: 16 }}>
        <h1 style={{ margin: 0, fontSize: 28, color: "#111827" }}>Business Portal</h1>
        <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
          Select a business account to apply business routing on courier and docs requests.
        </p>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={load} style={btnGhostBtn}>Refresh</button>
          <Link href="/dashboard" style={btnGhost}>Back to dashboard</Link>
        </div>
      </div>

      {loading && <div style={panelStyle}>Loading business accounts…</div>}

      {error && (
        <div style={{ ...panelStyle, borderColor: "#fecaca" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> <span style={{ color: "#111827" }}>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, fontSize: 20, color: "#111827" }}>Account selection</h2>
            {accounts.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280" }}>
                No active business memberships found for your user yet.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ fontSize: 14, color: "#374151", fontWeight: 700 }}>Active business account</label>
                <select
                  value={selectedId || ""}
                  onChange={(e) => onSelect(e.target.value)}
                  style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", maxWidth: 520 }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {(a.name || "Business account")} — {a.role}
                    </option>
                  ))}
                </select>

                {selected && (
                  <div style={{ marginTop: 6, fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
                    <div><strong>ID:</strong> {selected.id}</div>
                    <div><strong>Billing email:</strong> {selected.billing_email || "—"}</div>
                    <div><strong>Status:</strong> {selected.status || "—"}</div>
                    <div><strong>Timezone:</strong> {selected.timezone || "—"}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, fontSize: 20, color: "#111827" }}>Quick actions</h2>
            <p style={{ marginTop: 0, color: "#6b7280" }}>
              These links carry your selected <code>businessAccountId</code> to the request flows.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href={courierHref} style={btnPrimary}>New Business Delivery</Link>
              <Link href={docsHref} style={btnGhost}>New Business Docs Request</Link>
              <Link href={deliveriesOpsHref} style={btnGhost}>Business Deliveries Ops</Link>
              <Link href={docsOpsHref} style={btnGhost}>Business Docs Queue</Link>
            </div>
          </div>

          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, fontSize: 20, color: "#111827" }}>Business billing snapshot</h2>
            {!selectedId ? (
              <p style={{ margin: 0, color: "#6b7280" }}>Select a business account to view billing/utilization snapshot.</p>
            ) : summary ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div style={miniCard}><div style={miniLabel}>MTD deliveries</div><div style={miniValue}>{summary.deliveriesCount}</div></div>
                <div style={miniCard}><div style={miniLabel}>MTD docs jobs</div><div style={miniValue}>{summary.docsCount}</div></div>
                <div style={miniCard}><div style={miniLabel}>MTD billed</div><div style={miniValue}>${(summary.billedCents / 100).toFixed(2)}</div></div>
                <div style={miniCard}><div style={miniLabel}>Unpaid docs</div><div style={miniValue}>${(summary.unpaidCents / 100).toFixed(2)}</div></div>
              </div>
            ) : (
              <p style={{ margin: 0, color: "#6b7280" }}>Loading billing snapshot…</p>
            )}
            {summaryError && <p style={{ margin: "8px 0 0", color: "#b91c1c", fontSize: 13 }}>{summaryError}</p>}
          </div>

          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, fontSize: 20, color: "#111827" }}>MVP scope status</h2>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#374151", lineHeight: 1.8 }}>
              <li>✅ Dedicated Business Deliveries dashboard</li>
              <li>✅ Dedicated Business Docs queue dashboard</li>
              <li>⬜ Recurring schedules/routes UI (pending)</li>
              <li>⬜ Package utilization/billing UI (pending)</li>
              <li>⬜ Team invite/role management UI (pending)</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  marginTop: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#fff",
  padding: 14,
};

const miniCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 10,
  background: "#f9fafb",
};

const miniLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
};

const miniValue: React.CSSProperties = {
  marginTop: 4,
  fontSize: 18,
  fontWeight: 800,
  color: "#111827",
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
  padding: "10px 12px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
