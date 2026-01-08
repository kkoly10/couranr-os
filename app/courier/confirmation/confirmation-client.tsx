"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ConfirmationClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const orderId = sp.get("orderId") || "";
  const deliveryId = sp.get("deliveryId") || "";
  const orderNumber = sp.get("orderNumber") || "";

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const canUpload = useMemo(() => {
    return !!deliveryId && !!orderId;
  }, [deliveryId, orderId]);

  async function uploadPickupPhoto() {
    setMsg(null);

    if (!canUpload) {
      setMsg("Missing delivery info. Please contact support.");
      return;
    }
    if (!file) {
      setMsg("Please choose a photo first.");
      return;
    }

    setBusy(true);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;

    if (!token) {
      setBusy(false);
      setMsg("Not authenticated. Please log in again.");
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    try {
      const form = new FormData();
      form.append("deliveryId", deliveryId);
      form.append("orderId", orderId);
      form.append("photo", file);

      const res = await fetch("/api/customer/upload-pickup-photo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Upload failed");
      }

      setMsg("Pickup photo uploaded. Redirecting to dashboard…");

      // small delay so user sees feedback
      setTimeout(() => router.push("/dashboard"), 700);
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>Payment received ✅</h1>
      <p style={{ marginTop: 10, color: "#444" }}>
        {orderNumber ? (
          <>
            Your order number is <strong>{orderNumber}</strong>.
          </>
        ) : (
          <>
            Your order has been created.
          </>
        )}
      </p>

      <div style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Upload pickup photo (required)</h2>
        <p style={{ marginTop: 8, color: "#555", lineHeight: 1.5 }}>
          Please upload a clear photo of the item at pickup. This protects both you and the driver.
        </p>

        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={{ marginTop: 10 }}
        />

        {msg && (
          <div style={{ marginTop: 12, fontWeight: 700, color: msg.includes("uploaded") ? "#166534" : "#b91c1c" }}>
            {msg}
          </div>
        )}

        <button
          onClick={uploadPickupPhoto}
          disabled={busy || !file}
          style={{
            marginTop: 14,
            padding: "12px 16px",
            borderRadius: 10,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Uploading…" : "Upload photo"}
        </button>

        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          After upload, you’ll be taken to your dashboard to track the delivery.
        </div>
      </div>
    </div>
  );
}