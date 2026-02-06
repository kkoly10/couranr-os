"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RentalSummary = {
  id: string;
  status: string;
  purpose: "personal" | "rideshare";
  docs_complete: boolean;
  agreement_signed: boolean;
  paid: boolean;
  lockbox_code_released_at: string | null;
  vehicles: { year: number; make: string; model: string } | null;
};

const TEST_MODE =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_AUTO_TEST_MODE === "1" ||
    process.env.NEXT_PUBLIC_AUTO_TEST_MODE === "true" ||
    // backwards compatibility with your existing banner:
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

  // verification files
  const [licenseFront, setLicenseFront] = useState<File | null>(null);
  const [licenseBack, setLicenseBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token || null;
      setToken(t);

      if (!t) {
        router.push(
          `/login?next=${encodeURIComponent(
            window.location.pathname + window.location.search
          )}`
        );
        return;
      }

      if (!rentalId) {
        setMsg("Missing rentalId.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/auto/rental?rentalId=${encodeURIComponent(rentalId)}`,
          { headers: { Authorization: `Bearer ${t}` } }
        );
        const data2 = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data2?.error || "Failed to load rental");
        setRental(data2.rental);
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

  async function uploadVerification(kind: "license_front" | "license_back" | "selfie", file: File) {
    if (!token) throw new Error("Not authenticated");

    const form = new FormData();
    form.append("rentalId", rentalId);
    form.append("kind", kind);
    form.append("file", file);

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

    setBusy(true);
    try {
      await uploadVerification("license_front", licenseFront!);
      await uploadVerification("license_back", licenseBack!);
      await uploadVerification("selfie", selfie!);

      // reload rental snapshot
      const res = await fetch(`/api/auto/rental?rentalId=${encodeURIComponent(rentalId)}`, {
        headers: { Authorization: `Bearer ${token!}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRental(data.rental);

      setMsg("Verification uploaded ✅ You can continue to agreement/payment.");
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function goToAgreement() {
    if (!rentalId) return;
    router.push(`/auto/agreement?rentalId=${encodeURIComponent(rentalId)}`);
  }

  async function goToPayment() {
    setMsg(null);
    if (!token) return;

    // Only block if docs not complete yet (payment should be after docs)
    if (!rental?.docs_complete) {
      setMsg("Please upload your verification documents first.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auto/start-checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rentalId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to start checkout");

      window.location.href = data.url;
    } catch (e: any) {
      setMsg(e?.message || "Server error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!rental) return <p style={{ padding: 24 }}>{msg || "Rental not found."}</p>;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Step 3: Verification</h1>
      <p style={{ color: "#555", marginTop: 8 }}>
        {carTitle} • Purpose:{" "}
        <strong>{rental.purpose === "rideshare" ? "Rideshare" : "Personal"}</strong>
      </p>

      {TEST_MODE && (
        <div style={{ ...notice, background: "#fff7ed", borderColor: "#fed7aa", color: "#9a3412" }}>
          <strong>TEST MODE:</strong> Enabled (client). GPS checks should be bypassed where applicable.
        </div>
      )}

      <div style={card}>
        <h2 style={h2}>Required before agreement & payment</h2>

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

          <div style={hint}>Buckets are private. Files are stored securely and linked only to your rental.</div>
        </div>

        {msg && (
          <div style={{ marginTop: 14, fontWeight: 800, color: msg.includes("✅") ? "#166534" : "#b91c1c" }}>
            {msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
          <button onClick={doVerificationUploads} disabled={busy} style={primaryBtn}>
            {busy ? "Working…" : "Upload verification"}
          </button>

          <button onClick={goToAgreement} disabled={busy || !rental.docs_complete} style={secondaryBtn}>
            Sign agreement
          </button>

          <button
            onClick={goToPayment}
            disabled={busy || !rental.docs_complete}
            style={{ ...secondaryBtn, opacity: busy || !rental.docs_complete ? 0.6 : 1 }}
          >
            Continue to payment
          </button>
        </div>

        <div style={{ marginTop: 14, color: "#6b7280", fontSize: 12 }}>
          Pickup photos happen later (after approval + lockbox release) on the Photos step.
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800 }}>{children}</div>;
}

const card: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 18,
  background: "#fff",
};

const panel: React.CSSProperties = {
  marginTop: 12,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 14,
  background: "#f9fafb",
};

const notice: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1e3a8a",
};

const h2: React.CSSProperties = { margin: 0, fontSize: 18 };
const h3: React.CSSProperties = { margin: 0, fontSize: 16 };
const p: React.CSSProperties = { marginTop: 8, color: "#555", lineHeight: 1.5 };
const hint: React.CSSProperties = { marginTop: 10, fontSize: 12, color: "#6b7280" };

const primaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#fff",
  color: "#111827",
  fontWeight: 900,
  cursor: "pointer",
};