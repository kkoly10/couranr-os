"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SuccessClient() {
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [note, setNote] = useState<string>(
    "Payment completed ✅ Your rental is now in review. You’ll get lockbox instructions after approval."
  );

  useEffect(() => {
    // Optional: clear corrupted refresh tokens so they don’t spam console/errors
    (async () => {
      try {
        // This does NOT force a refresh call; it reads cached session if present
        const { data } = await supabase.auth.getSession();
        // If session object is missing but storage has junk, Supabase may throw later.
        // We proactively sign out only if Supabase reports an auth error elsewhere.
        if (!data?.session) {
          // Not logged in (normal after Stripe). No action needed.
          return;
        }
      } catch (e: any) {
        // If refresh token is invalid, wipe it clean
        const msg = String(e?.message || "");
        if (msg.toLowerCase().includes("refresh token")) {
          await supabase.auth.signOut();
          setNote(
            "Payment completed ✅ (Session refreshed). Please log in again to view your rental status."
          );
        }
      }
    })();
  }, []);

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
