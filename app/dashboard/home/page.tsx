"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function CustomerHomeDashboard() {
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? "");
    });
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Dashboard</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        {email ? `Signed in as ${email}` : "Signed in"}
      </p>

      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          href="/auto/available"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "#111827",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 900,
          }}
        >
          Browse cars
        </Link>

        <Link
          href="/dashboard/auto"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111827",
            color: "#111827",
            textDecoration: "none",
            fontWeight: 900,
            background: "#fff",
          }}
        >
          My rentals
        </Link>
      </div>

      <div style={{ marginTop: 18, color: "#6b7280", fontSize: 13, lineHeight: 1.6 }}>
        If you just paid, check “My rentals” for status updates and next steps.
      </div>
    </div>
  );
}