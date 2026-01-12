"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CheckoutClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rentalId = searchParams.get("rentalId") || "";

  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function startCheckout() {
      if (!rentalId) {
        setError("Missing rental ID.");
        setLoading(false);
        return;
      }

      // 1️⃣ Ensure user is authenticated
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push(
          `/login?next=/auto/checkout?rentalId=${encodeURIComponent(rentalId)}`
        );
        return;
      }

      try {
        setRedirecting(true);

        // 2️⃣ Call your EXISTING start-checkout API
        const res = await fetch("/api/auto/start-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ rentalId }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || "Failed to start checkout");
        }

        if (!data?.url) {
          throw new Error("Checkout session URL not returned");
        }

        // 3️⃣ Redirect to Stripe Checkout
        window.location.href = data.url;
      } catch (err: any) {
        console.error("Checkout error:", err);
        setError(err.message || "Unable to start checkout");
        setRedirecting(false);
      } finally {
        setLoading(false);
      }
    }

    startCheckout();
  }, [rentalId, router]);

  /* ---------------- UI STATES ---------------- */

  if (loading || redirecting) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
        <h1 style={{ fontSize: 28 }}>Secure checkout</h1>
        <p style={{ marginTop: 12, color: "#555" }}>
          Redirecting you to secure payment…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
        <h1 style={{ fontSize: 26 }}>Checkout error</h1>
        <p style={{ marginTop: 12, color: "#b91c1c" }}>{error}</p>

        <button
          onClick={() => router.back()}
          style={{
            marginTop: 16,
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid #d1d5db",
            background: "#fff",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Go back
        </button>
      </div>
    );
  }

  return null;
}