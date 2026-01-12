"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AutoCheckoutPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const rentalId = sp.get("rentalId") || "";

  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function go() {
      setError(null);

      if (!rentalId) {
        setStatus("error");
        setError("Missing rentalId.");
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        router.push(`/login?next=${encodeURIComponent(`/auto/checkout?rentalId=${rentalId}`)}`);
        return;
      }

      try {
        const res = await fetch("/api/auto/start-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ rentalId }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to start checkout");

        const url = String(json.url || "");
        if (!url) throw new Error("Missing checkout URL");

        // Redirect to Stripe Checkout
        window.location.href = url;
      } catch (e: any) {
        setStatus("error");
        setError(e?.message || "Checkout failed");
      }
    }

    go();
  }, [rentalId, router]);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Checkout</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        Redirecting you to secure payment…
      </p>

      {status === "error" && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fff",
          }}
        >
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => router.push(`/dashboard/auto`)}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Back to Auto Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}