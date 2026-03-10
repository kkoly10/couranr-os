"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ConfirmationState =
  | { kind: "loading" }
  | {
      kind: "ready";
      paid: boolean;
      orderNumber: string;
      orderStatus: string;
      deliveryStatus: string;
      totalCents: number;
    }
  | { kind: "error"; message: string };

export default function ConfirmationClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const orderId = sp.get("orderId") || "";
  const deliveryId = sp.get("deliveryId") || "";
  const fallbackOrderNumber = sp.get("orderNumber") || "";

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [state, setState] = useState<ConfirmationState>({ kind: "loading" });

  const canUpload = useMemo(
    () =>
      !!deliveryId &&
      !!orderId &&
      state.kind === "ready" &&
      state.paid,
    [deliveryId, orderId, state]
  );

  useEffect(() => {
    async function loadConfirmation() {
      if (!orderId || !deliveryId) {
        setState({ kind: "error", message: "Missing confirmation details." });
        return;
      }

      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;

      if (!token) {
        router.push(
          `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
        );
        return;
      }

      try {
        const res = await fetch(
          `/api/customer/delivery-confirmation?orderId=${encodeURIComponent(
            orderId
          )}&deliveryId=${encodeURIComponent(deliveryId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          }
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Failed to load confirmation");
        }

        const c = data?.confirmation || {};
        setState({
          kind: "ready",
          paid: !!c.paid,
          orderNumber: c.orderNumber || fallbackOrderNumber,
          orderStatus: c.orderStatus || "unknown",
          deliveryStatus: c.deliveryStatus || "unknown",
          totalCents: Number(c.totalCents || 0),
        });
      } catch (e: any) {
        setState({
          kind: "error",
          message: e?.message || "Failed to load confirmation",
        });
      }
    }

    loadConfirmation();
  }, [orderId, deliveryId, fallbackOrderNumber, router]);

  async function uploadPickupPhoto() {
    setMsg(null);

    if (!canUpload) {
      setMsg("Payment has not been confirmed yet.");
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

  const title =
    state.kind === "ready"
      ? state.paid
        ? "Payment confirmed ✅"
        : "Payment is processing…"
      : state.kind === "error"
      ? "Confirmation error"
      : "Checking payment…";

  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />
      <div className="cContainer" style={{ maxWidth: 860 }}>
        <section className="section" style={{ marginTop: 0 }}>
          <div className="heroCard">
            <h1 className="pageTitle" style={{ fontSize: 30 }}>
              {title}
            </h1>

            {state.kind === "loading" && (
              <p className="pageDesc">Verifying your delivery payment status…</p>
            )}

            {state.kind === "error" && (
              <p className="pageDesc">{state.message}</p>
            )}

            {state.kind === "ready" && (
              <>
                <p className="pageDesc">
                  {state.orderNumber ? (
                    <>
                      Your order number is <strong>{state.orderNumber}</strong>.
                    </>
                  ) : (
                    <>Your delivery order has been created.</>
                  )}
                </p>

                <div className="finePrint" style={{ marginTop: 8 }}>
                  <div>
                    <strong>Order status:</strong> {state.orderStatus}
                  </div>
                  <div>
                    <strong>Delivery status:</strong> {state.deliveryStatus}
                  </div>
                  <div>
                    <strong>Total:</strong> ${(state.totalCents / 100).toFixed(2)}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="section">
          <div className="card">
            <h2 className="cardTitle" style={{ marginTop: 0 }}>
              Upload pickup photo
            </h2>
            <p className="cardDesc">
              Upload a clear photo of the item at pickup. This protects both you
              and the driver.
            </p>

            {state.kind === "ready" && !state.paid && (
              <div className="statusNote statusError">
                Payment is still processing. Photo upload will unlock once the
                payment is confirmed by the backend.
              </div>
            )}

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
                disabled={!canUpload}
              />
              <p className="finePrint" style={{ marginTop: 6 }}>
                Accepted formats: JPG, PNG, HEIC. Use a clear image with adequate
                lighting.
              </p>
            </div>

            {msg && (
              <div
                className={
                  msg.includes("uploaded")
                    ? "statusNote statusSuccess"
                    : "statusNote statusError"
                }
              >
                {msg}
              </div>
            )}

            <div className="heroActions" style={{ marginTop: 14 }}>
              <button
                className="btn btnGold"
                onClick={uploadPickupPhoto}
                disabled={busy || !file || !canUpload}
              >
                {busy ? "Uploading…" : "Upload photo"}
              </button>
              <button
                className="btn btnGhost"
                onClick={() => router.push("/dashboard/delivery")}
              >
                Go to delivery dashboard
              </button>
            </div>

            <div className="finePrint" style={{ marginTop: 10 }}>
              After upload, you’ll be taken to your delivery dashboard to track
              the delivery.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}