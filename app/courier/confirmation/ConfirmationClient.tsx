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

  const canUpload = useMemo(() => !!deliveryId && !!orderId, [deliveryId, orderId]);

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
      router.push(
        `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
      );
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
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      setMsg("Pickup photo uploaded. Redirecting to delivery dashboard…");
      setTimeout(() => router.push("/dashboard/delivery"), 700);
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />
      <div className="cContainer" style={{ maxWidth: 860 }}>
        <section className="section" style={{ marginTop: 0 }}>
          <div className="heroCard">
            <h1 className="pageTitle" style={{ fontSize: 30 }}>Payment received ✅</h1>
            <p className="pageDesc">
              {orderNumber ? (
                <>
                  Your order number is <strong>{orderNumber}</strong>.
                </>
              ) : (
                <>Your order has been created.</>
              )}
            </p>
          </div>
        </section>

        <section className="section">
          <div className="card">
            <h2 className="cardTitle" style={{ marginTop: 0 }}>Upload pickup photo (required)</h2>
            <p className="cardDesc">
              Please upload a clear photo of the item at pickup. This protects both you and the
              driver.
            </p>

            <div className="field">
              <label className="fieldLabel" htmlFor="pickup-photo">
                Pickup photo
              </label>
              <input
                id="pickup-photo"
                className="fieldInput fileInput"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <p className="finePrint" style={{ marginTop: 6 }}>
                Accepted formats: JPG, PNG, HEIC. Use a clear image with adequate lighting.
              </p>
            </div>

            {msg && (
              <div className={msg.includes("uploaded") ? "statusNote statusSuccess" : "statusNote statusError"}>
                {msg}
              </div>
            )}

            <div className="heroActions" style={{ marginTop: 14 }}>
              <button className="btn btnGold" onClick={uploadPickupPhoto} disabled={busy || !file}>
                {busy ? "Uploading…" : "Upload photo"}
              </button>
              <button className="btn btnGhost" onClick={() => router.push("/dashboard/delivery")}>
                Skip for now → Go to delivery dashboard
              </button>
            </div>

            <div className="finePrint" style={{ marginTop: 10 }}>
              After upload, you’ll be taken to your delivery dashboard to track the delivery.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
