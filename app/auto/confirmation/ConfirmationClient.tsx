"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RentalSummary = {
  id: string;
  purpose: "personal" | "rideshare";
  docs_complete: boolean;
  agreement_signed: boolean;
  paid: boolean;
  vehicles: { year: number; make: string; model: string } | null;
};

const TEST_MODE =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_AUTO_TEST_MODE === "1" ||
    process.env.NEXT_PUBLIC_AUTO_TEST_MODE === "true" ||
    process.env.NEXT_PUBLIC_TEST_MODE === "1" ||
    process.env.NEXT_PUBLIC_TEST_MODE === "true");

export default function ConfirmationClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [token, setToken] = useState<string | null>(null);
  const [rental, setRental] = useState<RentalSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ✅ Local gate (prevents server refresh from “flipping back” and killing the link)
  const [docsCompleteLocal, setDocsCompleteLocal] = useState(false);

  // Verification files
  const [licenseFront, setLicenseFront] = useState<File | null>(null);
  const [licenseBack, setLicenseBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);

  // Required meta
  const [licenseState, setLicenseState] = useState("VA");
  const [licenseExpires, setLicenseExpires] = useState("");
  const [hasInsurance, setHasInsurance] = useState<"" | "yes" | "no">("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token || null;
      setToken(t);

      if (!t) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      if (!rentalId) {
        setMsg("Missing rentalId.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/auto/rental?rentalId=${encodeURIComponent(rentalId)}`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        const data2 = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data2?.error || "Failed to load rental");

        setRental(data2.rental);

        // ✅ sync local gate from server when true
        if (data2?.rental?.docs_complete) setDocsCompleteLocal(true);
      } catch (e: any) {
        setMsg(e?.message || "Failed to load rental");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, rentalId]);

  const carTitle = useMemo(() => {
    const v = rental?.vehicles;
    if (!v) return "Your rental";
    return `${v.year} ${v.make} ${v.model}`.trim();
  }, [rental]);

  const docsReady = useMemo(() => {
    return !!licenseFront && !!licenseBack && !!selfie;
  }, [licenseFront, licenseBack, selfie]);

  const metaReady = useMemo(() => {
    return !!licenseState.trim() && !!licenseExpires && !!hasInsurance;
  }, [licenseState, licenseExpires, hasInsurance]);

  async function uploadVerification(kind: "license_front" | "license_back" | "selfie", file: File) {
    if (!token) throw new Error("Not authenticated");

    const form = new FormData();
    form.append("rentalId", rentalId);
    form.append("kind", kind);
    form.append("file", file);

    // send required meta on every call
    form.append("licenseState", licenseState.trim().toUpperCase());
    form.append("licenseExpires", licenseExpires); // YYYY-MM-DD
    form.append("hasInsurance", String(hasInsurance === "yes"));

    const res = await fetch("/api/auto/upload-verification", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Upload failed");
  }

  async function doVerificationUploads() {
    setMsg(null);

    if (!rentalId) return setMsg("Missing rentalId.");
    if (!docsReady) return setMsg("Upload license front/back and a selfie first.");
    if (!metaReady) return setMsg("Please enter license state, expiration date, and insurance selection.");

    setBusy(true);
    try {
      await uploadVerification("license_front", licenseFront!);
      await uploadVerification("license_back", licenseBack!);
      await uploadVerification("selfie", selfie!);

      // ✅ Make links clickable immediately and keep them clickable
      setDocsCompleteLocal(true);
      setRental((prev) => (prev ? { ...prev, docs_complete: true } : prev));

      // Refresh snapshot (nice-to-have) — but DON'T let it turn local gate off
      const res = await fetch(`/api/auto/rental?rentalId=${encodeURIComponent(rentalId)}`, {
        headers: { Authorization: `Bearer ${token!}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.rental) {
        setRental(data.rental);
        if (data.rental.docs_complete) setDocsCompleteLocal(true);
      }

      setMsg("Verification uploaded ✅ You can continue to agreement/payment.");
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!rental) return <p style={{ padding: 24 }}>{msg || "Rental not found."}</p>;

  const canProceed = docsCompleteLocal; // ✅ the only gate we use for clickability now

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Step 3: Verification</h1>

      <p style={{ color: "#555", marginTop: 8 }}>
        {carTitle} • Purpose: <strong>{rental.purpose === "rideshare" ? "Rideshare" : "Personal"}</strong>
      </p>

      {TEST_MODE && (
        <div style={{ ...notice, background: "#fff7ed", borderColor: "#fed7aa", color: "#9a3412" }}>
          <strong>TEST MODE:</strong> Enabled (client). GPS checks should be bypassed where applicable.
        </div>
      )}

      <div style={card}>
        <h2 style={h2}>Required before agreement & payment</h2>

        <div style={grid}>
          <div style={panel}>
            <h3 style={h3}>Identity verification</h3>
            <p style={p}>
              Upload your driver license and a selfie. These are used for fraud prevention and dispute resolution.
            </p>

            <Label>License front (required)</Label>
            <input type="file" accept="image/*" onChange={(e) => setLicenseFront(e.target.files?.[0] || null)} />

            <Label>License back (required)</Label>
            <input type="file" accept="image/*" onChange={(e) => setLicenseBack(e.target.files?.[0] || null)} />

            <Label>Selfie (required)</Label>
            <input type="file" accept="image/*" onChange={(e) => setSelfie(e.target.files?.[0] || null)} />

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div>
                <Label>License state (required)</Label>
                <input
                  value={licenseState}
                  onChange={(e) => setLicenseState(e.target.value.toUpperCase())}
                  placeholder="VA"
                  maxLength={2}
                  style={input}
                />
              </div>

              <div>
                <Label>License expiration (required)</Label>
                <input type="date" value={licenseExpires} onChange={(e) => setLicenseExpires(e.target.value)} style={input} />
              </div>

              <div>
                <Label>Do you have active auto insurance? (required)</Label>
                <select value={hasInsurance} onChange={(e) => setHasInsurance(e.target.value as any)} style={input}>
                  <option value="">Select</option>
                  <option value="yes">Yes — I have my own insurance</option>
                  <option value="no">No — I will use Couranr coverage</option>
                </select>
              </div>
            </div>

            <div style={hint}>Buckets are private. Files are stored securely and linked only to your rental.</div>
          </div>
        </div>

        {msg && (
          <div style={{ marginTop: 14, fontWeight: 900, color: msg.includes("✅") ? "#166534" : "#b91c1c" }}>
            {msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
          <button onClick={doVerificationUploads} disabled={busy} style={primaryBtn}>
            {busy ? "Working…" : "Upload verification"}
          </button>

          <Link
            href={`/auto/agreement?rentalId=${encodeURIComponent(rentalId)}`}
            style={{
              ...secondaryLinkBtn,
              opacity: busy || !canProceed ? 0.6 : 1,
              pointerEvents: busy || !canProceed ? "none" : "auto",
            }}
          >
            Sign agreement
          </Link>

          <Link
            href={`/auto/checkout?rentalId=${encodeURIComponent(rentalId)}`}
            style={{
              ...secondaryLinkBtn,
              opacity: busy || !canProceed ? 0.6 : 1,
              pointerEvents: busy || !canProceed ? "none" : "auto",
            }}
          >
            Continue to payment
          </Link>
        </div>

        <div style={{ marginTop: 14, color: "#6b7280", fontSize: 12 }}>
          Pickup photos happen later (after approval + lockbox release) on the Photos step.
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 10, fontSize: 13, fontWeight: 900 }}>{children}</div>;
}

const card: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 18,
  background: "#fff",
};

const grid: React.CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  marginTop: 12,
};

const panel: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 14,
  background: "#f9fafb",
};

const notice: React.CSSProperties = {
  marginBottom: 14,
  borderRadius: 14,
  padding: 12,
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  color: "#1e3a8a",
};

const h2: React.CSSProperties = { margin: 0, fontSize: 18 };
const h3: React.CSSProperties = { margin: 0, fontSize: 16 };
const p: React.CSSProperties = { marginTop: 8, color: "#555", lineHeight: 1.5 };
const hint: React.CSSProperties = { marginTop: 10, fontSize: 12, color: "#6b7280" };

const input: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "#fff",
};

const primaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryLinkBtn: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#fff",
  color: "#111827",
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-block",
};