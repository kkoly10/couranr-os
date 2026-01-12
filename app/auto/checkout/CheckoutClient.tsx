"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CheckoutClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rentalId = searchParams.get("rentalId");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function startCheckout() {
      if (!rentalId) {
        setError("Missing rental reference.");
        setLoading(false);
        return;
      }

      try {
        // 🔐 Must be authenticated
        const { data: sessionRes } = await supabase.auth.getSession();
        const token = sessionRes.session?.access_token;

        if (!token) {
          router.push(`/login?next=${encodeURIComponent(window.location.href)}`);
          return;
        }

        const res = await fetch("/api/auto/start-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ rentalId }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || "Unable to start checkout");
        }

        if (!data.url) {
          throw new Error("Stripe checkout URL not returned.");
        }

        // 🚀 Redirect to Stripe
        window.location.href = data.url;
      } catch (e: any) {
        setError(e?.message || "Checkout failed");
        setLoading(false);
      }
    }

    startCheckout();
  }, [rentalId, router]);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 40 }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>
        Secure Checkout
      </h1>

      {loading && (
        <p style={{ color: "#555" }}>
          Preparing your payment securely…
        </p>
      )}

      {error && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fff",
          }}
        >
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => router.back()}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                background: "#111827",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Go back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}