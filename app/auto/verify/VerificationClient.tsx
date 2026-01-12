"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function VerificationClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [licenseFront, setLicenseFront] = useState<File | null>(null);
  const [licenseBack, setLicenseBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);

  const [licenseState, setLicenseState] = useState("");
  const [licenseExpires, setLicenseExpires] = useState("");
  const [hasInsurance, setHasInsurance] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!rentalId) {
      setError("Missing rental reference.");
    }
  }, [rentalId]);

  async function upload() {
    setError(null);
    setSuccess(null);

    if (
      !licenseFront ||
      !licenseBack ||
      !selfie ||
      !licenseState ||
      !licenseExpires ||
      !hasInsurance
    ) {
      setError("All fields and photos are required.");
      return;
    }

    setBusy(true);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const form = new FormData();
      form.append("rentalId", rentalId);
      form.append("licenseFront", licenseFront);
      form.append("licenseBack", licenseBack);
      form.append("selfie", selfie);
      form.append("licenseState", licenseState);
      form.append("licenseExpires", licenseExpires);
      form.append("hasInsurance", hasInsurance);

      const res = await fetch("/api/auto/upload-verification", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      setSuccess(
        "Verification submitted. Our team will review shortly. You will be notified once approved."
      );

      setTimeout(() => {
        router.push("/dashboard");
      }, 1200);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1>Identity Verification</h1>
      <p style={{ color: "#555" }}>
        Required before payment and vehicle access.
      </p>

      <div style={card}>
        <Field label="Driver License — Front">
          <input type="file" accept="image/*" onChange={(e) => setLicenseFront(e.target.files?.[0] || null)} />
        </Field>

        <Field label="Driver License — Back">
          <input type="file" accept="image/*" onChange={(e) => setLicenseBack(e.target.files?.[0] || null)} />
        </Field>

        <Field label="Selfie (face clearly visible)">
          <input type="file" accept="image/*" onChange={(e) => setSelfie(e.target.files?.[0] || null)} />
        </Field>

        <Field label="License State">
          <input value={licenseState} onChange={(e) => setLicenseState(e.target.value.toUpperCase())} placeholder="VA" />
        </Field>

        <Field label="License Expiration Date">
          <input type="date" value={licenseExpires} onChange={(e) => setLicenseExpires(e.target.value)} />
        </Field>

        <Field label="Do you have active auto insurance?">
          <select value={hasInsurance} onChange={(e) => setHasInsurance(e.target.value)}>
            <option value="">Select</option>
            <option value="yes">Yes — I have my own insurance</option>
            <option value="no">No — I will use Couranr coverage</option>
          </select>
        </Field>

        {error && <p style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</p>}
        {success && <p style={{ color: "#166534", fontWeight: 700 }}>{success}</p>}

        <button
          disabled={busy}
          onClick={upload}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "14px",
            borderRadius: 10,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Submitting…" : "Submit Verification"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontWeight: 700, fontSize: 13 }}>{label}</label>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  marginTop: 20,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 18,
  background: "#fff",
};