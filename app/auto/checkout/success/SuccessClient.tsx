"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SuccessClient() {
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";
  const sessionId = sp.get("session_id") || "";

  const [note, setNote] = useState<string>(
    "Payment received. Your rental is now pending admin review before lockbox release."
  );

  useEffect(() => {
    async function confirmCheckoutIfNeeded() {
      if (!rentalId || !sessionId) return;

      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const res = await fetch("/api/auto/confirm-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ rentalId, sessionId }),
        });

        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          const status = String(json?.status || "").toLowerCase();

          if (status === "pickup_ready") {
            setNote(
              "Payment confirmed ✅ Your rental is fully cleared for the next step and lockbox access can be released."
            );
          } else {
            setNote(
              "Payment confirmed ✅ Your rental is now pending admin review before lockbox release."
            );
          }
          return;
        }

        if (json?.error) {
          setNote(
            `Payment submitted. Backend confirmation is still in progress. (${json.error})`
          );
        }
      } catch {
        // best effort
      }
    }

    confirmCheckoutIfNeeded();
  }, [rentalId, sessionId]);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Payment complete</h1>
      <p style={{ marginTop: 10, color: "#555", lineHeight: 1.6 }}>{note}</p>

      {rentalId ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Rental ID: <strong>{rentalId}</strong>
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          href="/dashboard/auto"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "#111827",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 900,
          }}
        >
          Go to Auto Dashboard
        </Link>

        <Link
          href="/login?next=/dashboard/auto"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111827",
            color: "#111827",
            textDecoration: "none",
            fontWeight: 900,
          }}
        >
          Log in (if needed)
        </Link>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>
        Next steps: admin review → lockbox release → pickup photos on-site → confirm pickup.
      </div>
    </div>
  );
}