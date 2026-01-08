"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ConfirmationClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const orderId = sp.get("orderId");
  const deliveryId = sp.get("deliveryId");
  const orderNumber = sp.get("orderNumber");

  const canUpload = !!orderId && !!deliveryId;

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function uploadPickupPhoto() {
    if (!file || !canUpload) return;

    setBusy(true);
    setMsg(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.push("/login");
      return;
    }

    try {
      const form = new FormData();
      form.append("deliveryId", deliveryId!);
      form.append("orderId", orderId!);
      form.append("photo", file);

      const res = await fetch("/api/customer/upload-pickup-photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Upload failed");

      setMsg("Pickup photo uploaded. Redirecting…");
      setTimeout(() => router.push("/dashboard"), 800);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>Payment received ✅</h1>

      {orderNumber && (
        <p>Your order number is <strong>{orderNumber}</strong>.</p>
      )}

      {canUpload ? (
        <div style={{ marginTop: 20 }}>
          <h3>Upload pickup photo (required)</h3>

          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />

          {msg && <p>{msg}</p>}

          <button
            onClick={uploadPickupPhoto}
            disabled={busy || !file}
            style={{ marginTop: 12 }}
          >
            {busy ? "Uploading…" : "Upload photo"}
          </button>
        </div>
      ) : (
        <p style={{ marginTop: 20, color: "#555" }}>
          Pickup photo was already handled for this order.
        </p>
      )}
    </div>
  );
}