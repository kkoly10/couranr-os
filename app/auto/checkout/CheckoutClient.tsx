"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CheckoutClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [msg, setMsg] = useState("Starting checkout…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function go() {
      setError(null);

      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      const res = await fetch("/api/auto/start-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rentalId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Checkout failed");
        setMsg("Cannot proceed to payment.");
        return;
      }

      setMsg("Redirecting to Stripe…");
      window.location.href = data.url;
    }

    if (!rentalId) {
      setError("Missing rentalId");
      setMsg("Cannot proceed.");
      return;
    }

    go();
  }, [rentalId, router]);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1>Checkout</h1>
      <p style={{ color: "#555" }}>{msg}</p>
      {error && <div style={{ marginTop: 14, color: "#b91c1c", fontWeight: 800 }}>{error}</div>}
    </div>
  );
}