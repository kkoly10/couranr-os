"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RentalSummary = {
  rentalId: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    trim?: string | null;
    dailyRateCents: number;
    weeklyRateCents: number;
    depositCents: number;
    imageUrl?: string | null;
  };
  purpose: "personal" | "rideshare";
  pickupAtText: string;
  returnAtText: string;
  pricingMode: "daily" | "weekly";
  rateCents: number;
  depositCents: number;
  status: string;
  docsComplete: boolean;
  conditionPhotosComplete: boolean;
  agreementSigned: boolean;
};

type UploadKind =
  | "license_front"
  | "license_back"
  | "pre_exterior"
  | "pre_interior"
  | "post_exterior"
  | "post_interior";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ConfirmationClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [loading, setLoading] = useState(true);
  const [rental, setRental] = useState<RentalSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [signedName, setSignedName] = useState("");
  const [agree, setAgree] = useState(false);

  const [files, setFiles] = useState<Record<UploadKind, File | null>>({
    license_front: null,
    license_back: null,
    pre_exterior: null,
    pre_interior: null,
    post_exterior: null,
    post_interior: null,
  });

  const [busyUpload, setBusyUpload] = useState<UploadKind | null>(null);
  const [busySign, setBusySign] = useState(false);
  const [busyPay, setBusyPay] = useState(false);

  async function requireSession() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      throw new Error("Not authenticated.");
    }
    return token;
  }

  async function loadRental() {
    setLoading(true);
    setErr(null);
    try {
      if (!rentalId) throw new Error("Missing rentalId");
      const token = await requireSession();

      const res = await fetch(`/api/auto/rental-summary?rentalId=${encodeURIComponent(rentalId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load rental");

      setRental(data.rental);
    } catch (e: any) {
      setErr(e?.message || "Failed to load rental");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRental();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalId]);

  const agreementText = useMemo(() => {
    const p = rental?.purpose || "personal";

    // NOTE: This is a readable, MVP agreement display.
    // The “paste-ready” clauses you approved should be stored in a constant or server template later.
    // For now: show summary + link to full policy page (optional next step).
    if (p === "rideshare") {
      return `
RIDESHARE RENTAL AGREEMENT (MVP)

Purpose: Rideshare (Uber/Lyft permitted under this agreement)

Key differences vs personal:
- Weekly payment only (or weekly-first). Extensions are weekly.
- Mileage: Unlimited miles for rideshare use (normal abuse rules still apply).
- Vehicle may be inspected more frequently.
- Renter must follow platform rules and local laws.
- Prohibited use still includes: racing, off-road, towing, illegal activity, DUI, unauthorized drivers.

All other policies apply:
- Damage responsibility, deductible rules (if using Couranr coverage), deposit use, cleaning fees, smoking fees, late return fees, and identity verification.
`;
    }

    return `
PERSONAL RENTAL AGREEMENT (MVP)

Purpose: Personal / Leisure

Key points:
- Pickup/return at 1090 Stafford Marketplace VA 22556 (9am–6pm).
- Late return: grace window + extra charges may apply.
- Mileage: Limited per our policy (locked as recommended).
- Insurance required OR optional Couranr coverage surcharge applies.
- No rideshare use under personal agreement.

All other policies apply:
- Damage responsibility, deductible rules (if using Couranr coverage), deposit use, cleaning fees, smoking fees, late return fees, and identity verification.
`;
  }, [rental?.purpose]);

  const canPay = useMemo(() => {
    if (!rental) return false;
    // Must have: docs + pre-condition photos + agreement signed
    return rental.docsComplete && rental.conditionPhotosComplete && rental.agreementSigned;
  }, [rental]);

  async function upload(kind: UploadKind) {
    setErr(null);
    try {
      if (!rentalId) throw new Error("Missing rentalId");
      const file = files[kind];
      if (!file) throw new Error("Choose a file first.");

      const token = await requireSession();
      setBusyUpload(kind);

      const form = new FormData();
      form.append("rentalId", rentalId);
      form.append("kind", kind);
      form.append("file", file);

      const res = await fetch("/api/auto/upload-rental-file", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      // reload summary so UI updates gating flags
      await loadRental();
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusyUpload(null);
    }
  }

  async function signAgreement() {
    setErr(null);
    try {
      if (!rental) throw new Error("Missing rental");
      if (!signedName.trim()) throw new Error("Enter your full name to sign.");
      if (!agree) throw new Error("You must agree to proceed.");

      const token = await requireSession();
      setBusySign(true);

      const res = await fetch("/api/auto/sign-agreement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rentalId,
          signedName: signedName.trim(),
          purpose: rental.purpose,
          signedText: agreementText.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to sign");

      await loadRental();
    } catch (e: any) {
      setErr(e?.message || "Failed to sign agreement");
    } finally {
      setBusySign(false);
    }
  }

  async function continueToPayment() {
    setErr(null);
    try {
      if (!rental) throw new Error("Missing rental");
      if (!canPay) throw new Error("Complete uploads and sign agreement first.");

      const token = await requireSession();
      setBusyPay(true);

      const res = await fetch("/api/auto/start-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rentalId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to start checkout");

      if (!data?.url) throw new Error("Missing Stripe URL");
      window.location.href = data.url;
    } catch (e: any) {
      setErr(e?.message || "Failed to continue");
    } finally {
      setBusyPay(false);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (err) return <p style={{ padding: 24, color: "#b91c1c" }}>{err}</p>;
  if (!rental) return <p style={{ padding: 24 }}>Rental not found.</p>;

  const img = rental.vehicle.imageUrl || "";

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px" }}>
      <h1 style={{ margin: 0, fontSize: 30 }}>Confirm & Continue</h1>
      <p style={{ marginTop: 10, color: "#555", lineHeight: 1.6 }}>
        Complete verification and sign your agreement before payment.
      </p>

      {err && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", color: "#7f1d1d" }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div style={card}>
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ width: 120, height: 80, borderRadius: 12, background: "#f3f4f6", overflow: "hidden", border: "1px solid #e5e7eb" }}>
              {img ? <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
            </div>
            <div>
              <div style={{ fontWeight: 900 }}>
                {rental.vehicle.year} {rental.vehicle.make} {rental.vehicle.model}
              </div>
              <div style={{ color: "#555", marginTop: 6 }}>
                Purpose: <strong>{rental.purpose === "rideshare" ? "Rideshare" : "Personal"}</strong>
              </div>
              <div style={{ color: "#555", marginTop: 6 }}>
                Pickup: <strong>{rental.pickupAtText}</strong>
                <br />
                Return: <strong>{rental.returnAtText}</strong>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb", color: "#111" }}>
            <div><strong>Rate:</strong> {money(rental.rateCents)} ({rental.pricingMode})</div>
            <div><strong>Deposit:</strong> {money(rental.depositCents)}</div>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900 }}>Required before payment</div>
          <ul style={{ marginTop: 10, color: "#444", lineHeight: 1.8 }}>
            <li>Driver’s license uploaded: <strong>{rental.docsComplete ? "✅" : "❌"}</strong></li>
            <li>Pre-rental condition photos uploaded: <strong>{rental.conditionPhotosComplete ? "✅" : "❌"}</strong></li>
            <li>Agreement signed: <strong>{rental.agreementSigned ? "✅" : "❌"}</strong></li>
          </ul>

          <button
            onClick={continueToPayment}
            disabled={!canPay || busyPay}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "12px 16px",
              borderRadius: 12,
              border: "none",
              background: !canPay ? "#9ca3af" : "#111827",
              color: "#fff",
              fontWeight: 900,
              cursor: !canPay ? "not-allowed" : "pointer",
            }}
          >
            {busyPay ? "Starting checkout…" : "Continue to Payment"}
          </button>

          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Keys are released only after payment + verification completion.
          </div>
        </div>
      </div>

      {/* Uploads */}
      <div style={{ marginTop: 16, ...card }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Upload documents</h2>
        <p style={{ marginTop: 8, color: "#555" }}>
          To prevent fraud, we require a clear driver’s license photo.
        </p>

        <div style={uploadGrid}>
          {uploadBox("License (front)", "license_front")}
          {uploadBox("License (back)", "license_back")}
          {uploadBox("Car photos (pre) – exterior", "pre_exterior")}
          {uploadBox("Car photos (pre) – interior", "pre_interior")}
        </div>
      </div>

      {/* Agreement */}
      <div style={{ marginTop: 16, ...card }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Agreement</h2>
        <p style={{ marginTop: 8, color: "#555" }}>
          This agreement is based on your selected purpose:{" "}
          <strong>{rental.purpose === "rideshare" ? "Rideshare" : "Personal"}</strong>
        </p>

        <pre style={pre}>
{agreementText.trim()}
        </pre>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Type full name to sign
          </label>
          <input
            value={signedName}
            onChange={(e) => setSignedName(e.target.value)}
            placeholder="Full legal name"
            style={input}
          />

          <label style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span style={{ color: "#111" }}>I agree to the terms above.</span>
          </label>

          <button
            onClick={signAgreement}
            disabled={busySign || !signedName.trim() || !agree}
            style={{
              marginTop: 12,
              padding: "12px 16px",
              borderRadius: 12,
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {busySign ? "Signing…" : "Sign Agreement"}
          </button>
        </div>
      </div>
    </div>
  );

  function uploadBox(title: string, kind: UploadKind) {
    return (
      <div style={uploadCard} key={kind}>
        <div style={{ fontWeight: 900 }}>{title}</div>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFiles((s) => ({ ...s, [kind]: e.target.files?.[0] || null }))}
          style={{ marginTop: 10 }}
        />
        <button
          onClick={() => upload(kind)}
          disabled={busyUpload !== null || !files[kind]}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 800,
            cursor: busyUpload !== null ? "not-allowed" : "pointer",
          }}
        >
          {busyUpload === kind ? "Uploading…" : "Upload"}
        </button>
      </div>
    );
  }
}

/* ---------- styles ---------- */
const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
};

const uploadGrid: React.CSSProperties = {
  marginTop: 12,
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const uploadCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 12,
  background: "#fff",
};

const input: React.CSSProperties = {
  marginTop: 8,
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  outline: "none",
};

const pre: React.CSSProperties = {
  marginTop: 12,
  padding: 14,
  borderRadius: 14,
  background: "#0b1220",
  color: "#e5e7eb",
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  lineHeight: 1.5,
  fontSize: 13,
};