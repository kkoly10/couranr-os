"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SuccessClient() {
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [msg, setMsg] = useState<string>("Confirming payment…");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setMsg("Payment received. Please log in to view your rental status.");
        return;
      }

      // Pull latest snapshot so user sees updated paid status once webhook hits
      try {
        const res = await fetch(`/api/auto/rental?rentalId=${encodeURIComponent(rentalId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setMsg("Payment received ✅");
        else setMsg("Payment received ✅ (status updating…)"); // webhook might still be processing
      } catch {
        setMsg("Payment received ✅ (status updating…)"); 
      }
    })();
  }, [rentalId]);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>Payment complete</h1>
      <p style={{ marginTop: 10, color: "#555" }}>{msg}</p>

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          href={`/dashboard/auto`}
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

        {rentalId ? (
          <Link
            href={`/auto/access?rentalId=${encodeURIComponent(rentalId)}`}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111827",
              color: "#111827",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            View access step
          </Link>
        ) : null}
      </div>

      <p style={{ marginTop: 14, fontSize: 12, color: "#6b7280" }}>
        Next step: admin review → then lockbox code release → then pickup photos on-site → confirm pickup.
      </p>
    </div>
  );
}