"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveBusinessAccountId } from "@/lib/businessSelection";

function num(v: string | null, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function CheckoutClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const price = sp.get("price") ?? "0";
  const miles = sp.get("miles") ?? "0";
  const pickup = sp.get("pickup") ?? "";
  const dropoff = sp.get("dropoff") ?? "";
  const weight = sp.get("weight") ?? "0";
  const stops = sp.get("stops") ?? "0";
  const rush = sp.get("rush") === "1";
  const signature = sp.get("signature") === "1";
  const businessAccountId = resolveBusinessAccountId(sp.get("businessAccountId"));

  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");

  const amountCents = useMemo(() => Math.round(num(price) * 100), [price]);

  const quoteQS = useMemo(() => {
    const q = new URLSearchParams({
      pickup,
      dropoff,
      miles,
      weight,
      stops,
      rush: rush ? "1" : "0",
      signature: signature ? "1" : "0",
    });
    return q.toString();
  }, [pickup, dropoff, miles, weight, stops, rush, signature]);

  async function continueToPayment() {
    setErr(null);

    if (!recipientName.trim() || !recipientPhone.trim()) {
      setErr("Recipient name and phone are required.");
      return;
    }

    setLoading(true);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;

    if (!token) {
      setLoading(false);
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    const res = await fetch("/api/delivery/start-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pickupAddress: { address_line: pickup },
        dropoffAddress: { address_line: dropoff },
        estimatedMiles: num(miles),
        weightLbs: num(weight),
        rush,
        signatureRequired: signature,
        stops: num(stops),
        totalCents: amountCents,
        recipientName,
        recipientPhone,
        deliveryNotes: deliveryNotes || null,
        ...(businessAccountId ? { businessAccountId } : {}),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErr(data?.error || "Failed to continue to payment");
      setLoading(false);
      return;
    }

    setLoading(false);
    window.location.href = data.url;
  }

  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />
      <div className="cContainer" style={{ maxWidth: 940 }}>
        <section className="section" style={{ marginTop: 0 }}>
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Courier Checkout</span>
              <span className="badge ghost">Secure payment</span>
            </div>
            <h1 className="pageTitle" style={{ fontSize: 34 }}>Confirm delivery details</h1>
            <p className="pageDesc">Review your quote details and add recipient information before payment.</p>
            <div className="heroActions" style={{ marginTop: 12 }}>
              <Link className="btn btnGhost" href={`/courier/quote?${quoteQS}`}>
                ← Back to quote
              </Link>
              <button
                type="button"
                className="btn btnGhost"
                onClick={() => window.location.assign("/dashboard/delivery")}
              >
                Delivery dashboard
              </button>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="card">
            <h2 className="cardTitle" style={{ marginTop: 0 }}>Quote summary</h2>
            <div className="cardList" style={{ listStyle: "none", paddingLeft: 0, marginBottom: 0 }}>
              <div><strong>Pickup:</strong> {pickup || "—"}</div>
              <div><strong>Drop-off:</strong> {dropoff || "—"}</div>
              <div><strong>Miles:</strong> {num(miles).toFixed(2)}</div>
              <div><strong>Weight:</strong> {num(weight)} lbs</div>
              <div><strong>Total:</strong> ${num(price).toFixed(2)}</div>
              <div><strong>Context:</strong> {businessAccountId ? "Business" : "Personal"}</div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="card">
            <h2 className="cardTitle" style={{ marginTop: 0 }}>Recipient information</h2>

            <div className="field" style={{ marginTop: 10 }}>
              <label className="fieldLabel">Recipient name (required)</label>
              <input className="fieldInput" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label className="fieldLabel">Recipient phone (required)</label>
              <input className="fieldInput" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label className="fieldLabel">Delivery notes (optional)</label>
              <textarea
                className="fieldInput"
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                style={{ height: 100, paddingTop: 10 }}
              />
            </div>


            {!businessAccountId && (
              <div className="statusNote" style={{ marginTop: 10 }}>
                Need this billed to your business? Go back and choose <strong>Business account</strong> in quote context.
              </div>
            )}
            {err && <div className="statusNote statusError">{err}</div>}

            <div className="heroActions" style={{ marginTop: 14 }}>
              <button onClick={continueToPayment} disabled={loading} className="btn btnGold">
                {loading ? "Working…" : "Continue to payment"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
