// app/docs/success/SuccessClient.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type State =
  | { kind: "loading" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export default function SuccessClient() {
  const sp = useSearchParams();
  const requestId = sp.get("requestId") || "";
  const sessionId = sp.get("session_id") || "";
  const mode = sp.get("mode") || "";
  const alreadyPaid = sp.get("alreadyPaid") === "1";

  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    async function run() {
      try {
        if (!requestId) throw new Error("Missing requestId");

        if (alreadyPaid) {
          setState({ kind: "ok", message: "This request was already marked as paid." });
          return;
        }

        if (mode === "test") {
          setState({ kind: "ok", message: "Test payment completed successfully." });
          return;
        }

        if (!sessionId) throw new Error("Missing Stripe session_id");

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Please log in again to finalize payment.");

        const res = await fetch("/api/docs/confirm-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ requestId, sessionId }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Could not confirm payment");

        setState({ kind: "ok", message: "Payment confirmed. Your Docs request is now marked as paid." });
      } catch (e: any) {
        setState({ kind: "error", message: e?.message || "Payment confirmation failed" });
      }
    }

    run();
  }, [requestId, sessionId, mode, alreadyPaid]);

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={{ marginTop: 0 }}>Docs Payment</h1>

        {state.kind === "loading" && <p>Finalizing payment…</p>}

        {state.kind === "ok" && (
          <div style={styles.okBox}>
            <strong>Success:</strong> {state.message}
          </div>
        )}

        {state.kind === "error" && (
          <div style={styles.errBox}>
            <strong>Error:</strong> {state.message}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <Link href={`/dashboard/docs/${requestId}`} style={styles.btnPrimary}>
            View Request
          </Link>
          <Link href="/dashboard/docs" style={styles.btnGhost}>
            Docs Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  wrap: { maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "sans-serif" },
  card: { border: "1px solid #e5e7eb", borderRadius: 14, background: "#fff", padding: 16 },
  okBox: {
    marginTop: 10,
    border: "1px solid #bbf7d0",
    background: "#ecfdf5",
    color: "#166534",
    borderRadius: 12,
    padding: 12,
  },
  errBox: {
    marginTop: 10,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    borderRadius: 12,
    padding: 12,
  },
  btnPrimary: {
    border: "none",
    background: "#111827",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-block",
  },
  btnGhost: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-block",
  },
};