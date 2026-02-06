"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Kind = "license_front" | "license_back" | "selfie";

export default function VerificationClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [licenseFront, setLicenseFront] = useState<File | null>(null);
  const [licenseBack, setLicenseBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);

  const [licenseState, setLicenseState] = useState("");
  const [licenseExpires, setLicenseExpires] = useState("");
  const [hasInsurance, setHasInsurance] = useState<string>(""); // "yes" | "no"

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  const missing = useMemo(() => {
    const miss: string[] = [];
    if (!rentalId) miss.push("rentalId");
    if (!licenseFront) miss.push("licenseFront");
    if (!licenseBack) miss.push("licenseBack");
    if (!selfie) miss.push("selfie");
    if (!licenseState) miss.push("licenseState");
    if (!licenseExpires) miss.push("licenseExpires");
    if (!hasInsurance) miss.push("hasInsurance");
    return miss;
  }, [rentalId, licenseFront, licenseBack, selfie, licenseState, licenseExpires, hasInsurance]);

  useEffect(() => {
    if (!rentalId) setError("Missing rental reference.");
  }, [rentalId]);

  async function uploadOne(
    token: string,
    kind: Kind,
    file: File,
    includeMeta: boolean
  ) {
    const form = new FormData();
    form.append("rentalId", rentalId);
    form.append("kind", kind);
    form.append("file", file);

    // Send license meta (state/expiry/insurance) at least once.
    // Safe to include on all requests too, but we'll include only when includeMeta=true.
    if (includeMeta) {
      form.append("licenseState", licenseState.trim().toUpperCase());
      form.append("licenseExpires", licenseExpires); // "YYYY-MM-DD"
      // API expects boolean-ish string -> it converts "true"/"false"
      form.append("hasInsurance", hasInsurance === "yes" ? "true" : "false");
    }

    const res = await fetch("/api/auto/upload-verification", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `Upload failed (${kind})`);
    }
    return data;
  }

  async function submitVerification() {
    setError(null);
    setSuccess(null);
    setProgress("");

    if (missing.length > 0) {
      // Friendly message
      const msg =
        missing.includes("licenseState") || missing.includes("licenseExpires")
          ? "Missing licenseState / licenseExpires"
          : "All fields and photos are required.";
      setError(msg);
      return;
    }

    setBusy(true);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      // Upload in order. Include meta on the first request so DB gets it early.
      setProgress("Uploading license front…");
      await uploadOne(token, "license_front", licenseFront!, true);

      setProgress("Uploading license back…");
      await uploadOne(token, "license_back", licenseBack!, false);

      setProgress("Uploading selfie…");
      const final = await uploadOne(token, "selfie", selfie!, false);

      // final.complete should be true after all 3 are present
      if (!final?.complete) {
        // Not fatal, but very unlikely now
        setSuccess("Uploads saved. Verification is pending review.");
      } else {
        setSuccess("Verification submitted. Our team will review shortly.");
      }

      setProgress("");

      // Send renter to auto dashboard (more specific than /dashboard)
      setTimeout(() => {
        router.push("/dashboard/auto");
      }, 900);
    } catch (e: any) {
      setProgress("");
      setError(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0 }}>Identity Verification</h1>
      <p style={{ color: "#555", marginTop: 8 }}>
        Step 3A — Submit verification first. Pickup photos happen later (after approval + lockbox release).
      </p>

      <div style={card}>
        <Field label="Driver License — Front (required)">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setLicenseFront(e.target.files?.[0] || null)}
          />
        </Field>

        <Field label="Driver License — Back (required)">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setLicenseBack(e.target.files?.[0] || null)}
          />
        </Field>

        <Field label="Selfie (face clearly visible) (required)">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setSelfie(e.target.files?.[0] || null)}
          />
        </Field>

        <Field label="License State (required)">
          <input
            value={licenseState}
            onChange={(e) => setLicenseState(e.target.value.toUpperCase())}
            placeholder="VA"
            maxLength={2}
          />
        </Field>

        <Field label="License Expiration Date (required)">
          <input
            type="date"
            value={licenseExpires}
            onChange={(e) => setLicenseExpires(e.target.value)}
          />
        </Field>

        <Field label="Do you have active auto insurance? (required)">
          <select value={hasInsurance} onChange={(e) => setHasInsurance(e.target.value)}>
            <option value="">Select</option>
            <option value="yes">Yes — I have my own insurance</option>
            <option value="no">No — I will use Couranr coverage</option>
          </select>
        </Field>

        {progress && <p style={{ color: "#111", fontWeight: 700 }}>{progress}</p>}
        {error && <p style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</p>}
        {success && <p style={{ color: "#166534", fontWeight: 800 }}>{success}</p>}

        <button
          disabled={busy}
          onClick={submitVerification}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "14px",
            borderRadius: 10,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 900,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.85 : 1,
          }}
        >
          {busy ? "Submitting…" : "Submit Verification"}
        </button>

        <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>
          Missing: {missing.length ? missing.join(", ") : "none"}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontWeight: 800, fontSize: 13 }}>{label}</label>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  marginTop: 18,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 18,
  background: "#fff",
};