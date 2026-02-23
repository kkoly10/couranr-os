// app/docs/checkout/CheckoutClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DocRequest = {
  id: string;
  title?: string | null;
  service_type?: string | null;
  status?: string | null;
  paid?: boolean | null;
  quoted_total_cents?: number | null;
  final_total_cents?: number | null;
};

function envTrue(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

const TEST_MODE =
  typeof process !== "undefined" &&
  (envTrue(process.env.NEXT_PUBLIC_DOCS_TEST_MODE) || envTrue(process.env.NEXT_PUBLIC_TEST_MODE));

export default function CheckoutClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const requestId = sp.get("requestId") || "";
  const canceled = sp.get("canceled") === "1";

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "stripe" | "test">(null);
  const [error, setError] = useState<string | null>(null);
  const [requestRow, setRequestRow] = useState<DocRequest | null>(null);

  const amountCents = useMemo(
    () => Number(requestRow?.final_total_cents ?? requestRow?.quoted_total_cents ?? 0),
    [requestRow]
  );

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!requestId) throw new Error("Missing requestId");

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.push(`/login?next=${encodeURIComponent(`/docs/checkout?requestId=${requestId}`)}`);
        return;
      }

      const res = await fetch(`/api/docs/my-request-detail?requestId=${encodeURIComponent(requestId)}&t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load request");

      setRequestRow(json.request || null);
    } catch (e: any) {
      setError(e?.message || "Failed to load checkout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  async function payWithStripe() {
    setBusy("stripe");
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Unauthorized");

      const res = await fetch("/api/docs/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to start checkout");

      if (json.alreadyPaid) {
        router.push(`/docs/success?requestId=${encodeURIComponent(requestId)}&alreadyPaid=1`);
        return;
      }

      if (!json.url) throw new Error("Missing Stripe checkout URL");
      window.location.href = json.url;
    } catch (e: any) {
      setError(e?.message || "Checkout failed");
    } finally {
      setBusy(null);
    }
  }

  async function payTestMode() {
    setBusy("test");
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Unauthorized");

      const res = await fetch("/api/docs/test-mark-paid", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Test checkout failed");

      router.push(`/docs/success?requestId=${encodeURIComponent(requestId)}&mode=test`);
    } catch (e: any) {
      setError(e?.message || "Test payment failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading checkout…</p>;

  if (error) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <h1 style={{ marginTop: 0 }}>Docs Checkout</h1>
          <p style={{ color: "#b91c1c" }}><strong>Error:</strong> {error}</p>
          <div style={{ marginTop: 12 }}>
            <Link href="/dashboard/docs" style={styles.btnGhost}>Back to Docs Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!requestRow) return null;

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Docs Checkout</h1>
            <p style={{ margin: "6px 0 0 0", color: "#666" }}>
              Review your quote and complete payment.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/dashboard/docs/${requestId}`} style={styles.btnGhost}>Back to Request</Link>
          </div>
        </div>

        {canceled && (
          <div style={styles.warnBox}>
            Payment was canceled. No charge was made.
          </div>
        )}

        <div style={{ marginTop: 14, lineHeight: 1.75, color: "#374151", fontSize: 14 }}>
          <div><strong>Request:</strong> {requestRow.title || "Docs Request"}</div>
          <div><strong>Service:</strong> {String(requestRow.service_type || "—").replace(/_/g, " ")}</div>
          <div><strong>Status:</strong> {requestRow.status || "—"}</div>
          <div><strong>Paid:</strong> {requestRow.paid ? "Yes" : "No"}</div>
        </div>

        <div style={styles.totalBox}>
          <div style={{ fontSize: 13, color: "#6b7280" }}>Amount due</div>
          <div style={{ fontSize: 34, fontWeight: 900 }}>{formatMoney(amountCents)}</div>
        </div>

        {!amountCents || amountCents <= 0 ? (
          <div style={styles.warnBox}>
            No quote is available yet. Admin needs to set a quote first.
          </div>
        ) : requestRow.paid ? (
          <div style={styles.successBox}>
            This request is already paid.
            <div style={{ marginTop: 10 }}>
              <Link href={`/dashboard/docs/${requestId}`} style={styles.btnPrimary}>
                View Request
              </Link>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={payWithStripe}
              disabled={!!busy}
              style={{ ...styles.btnPrimary, width: "100%", marginTop: 10, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {busy === "stripe" ? "Redirecting…" : "Pay with card"}
            </button>

            {TEST_MODE && (
              <button
                onClick={payTestMode}
                disabled={!!busy}
                style={{ ...styles.btnGhostBtn, width: "100%", marginTop: 10, cursor: busy ? "not-allowed" : "pointer" }}
                title="Testing only"
              >
                {busy === "test" ? "Processing…" : "Test Mode: Mark Paid"}
              </button>
            )}

            <p style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Payments are processed securely. You’ll return to Couranr Docs after payment.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

const styles: Record<string, any> = {
  wrap: { maxWidth: 860, margin: "0 auto", padding: 24, fontFamily: "sans-serif" },
  card: { border: "1px solid #e5e7eb", borderRadius: 14, background: "#fff", padding: 16 },
  totalBox: {
    marginTop: 14,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    background: "#f8fafc",
  },
  warnBox: {
    marginTop: 12,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    borderRadius: 12,
    padding: 12,
  },
  successBox: {
    marginTop: 12,
    border: "1px solid #bbf7d0",
    background: "#ecfdf5",
    color: "#166534",
    borderRadius: 12,
    padding: 12,
  },
  btnPrimary: {
    border: "none",
    background: "#111827",
    color: "#fff",
    borderRadius: 10,
    padding: "12px 14px",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-block",
    textAlign: "center",
  },
  btnGhost: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-block",
  },
  btnGhostBtn: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    borderRadius: 10,
    padding: "12px 14px",
    fontWeight: 900,
  },
};