"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Purpose = "personal" | "rideshare";

export default function RentClient({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessionToken, setSessionToken] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSessionToken(data.session?.access_token || null);
    })();
  }, []);

  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    licenseNumber: "",
    licenseState: "VA",
    days: 1,
    pickupAt: "",
    purpose: "personal" as Purpose,
    signature: "",
  });

  function update<K extends keyof typeof form>(key: K, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const requiredMissing = useMemo(() => {
    if (!form.fullName.trim()) return "Full name is required";
    if (!form.phone.trim()) return "Phone is required";
    if (!form.licenseNumber.trim()) return "Driver license # is required";
    if (!form.licenseState.trim()) return "License state is required";
    if (!form.pickupAt) return "Pickup date & time is required";
    if (!form.signature.trim()) return "Signature is required";
    if (!form.purpose) return "Purpose is required";
    if (!Number.isFinite(Number(form.days)) || Number(form.days) < 1) return "Days must be at least 1";
    return null;
  }, [form]);

  async function submit() {
    setError(null);

    const missing = requiredMissing;
    if (missing) {
      setError(missing);
      return;
    }

    // Auth gate (prevents leakage + matches your RLS)
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auto/create-rental", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehicleId,
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          licenseNumber: form.licenseNumber.trim(),
          licenseState: form.licenseState.trim().toUpperCase(),
          days: Number(form.days),
          pickupAt: form.pickupAt,
          purpose: form.purpose,
          signature: form.signature.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create rental");

      // Step 3 happens on confirmation page (uploads + agreement + payment)
      router.push(`/auto/confirmation?rentalId=${encodeURIComponent(data.rentalId)}`);
    } catch (e: any) {
      setError(e?.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Reserve this vehicle</h2>
        <p style={styles.subtitle}>
          Verification, agreement, and payment come next.
        </p>

        <div style={styles.notice}>
          <strong>Pickup & pricing rules</strong>
          <ul style={{ marginTop: 10, lineHeight: 1.6 }}>
            <li>Location: <strong>1090 Stafford Marketplace, VA 22556</strong></li>
            <li>Hours: <strong>9:00 AM – 6:00 PM</strong></li>
            <li>Minimum lead time: <strong>50 minutes</strong></li>
            <li>Time rounded to the next <strong>30-minute</strong> block</li>
            <li>Same-day rentals are charged the <strong>daily</strong> rate</li>
            <li>Weekly pricing starts at <strong>7 days</strong></li>
          </ul>
        </div>

        <div style={styles.grid}>
          <Field label="Full name" required>
            <input
              value={form.fullName}
              onChange={(e) => update("fullName", e.target.value)}
              style={styles.input}
              placeholder="John Doe"
            />
          </Field>

          <Field label="Phone number" required>
            <input
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              style={styles.input}
              placeholder="(555) 123-4567"
            />
          </Field>

          <Field label="Driver license #" required>
            <input
              value={form.licenseNumber}
              onChange={(e) => update("licenseNumber", e.target.value)}
              style={styles.input}
              placeholder="License number"
            />
          </Field>

          <Field label="License state" required>
            <input
              value={form.licenseState}
              onChange={(e) => update("licenseState", e.target.value)}
              style={styles.input}
              placeholder="VA"
              maxLength={2}
            />
          </Field>

          <Field label="Rental purpose" required>
            <select
              value={form.purpose}
              onChange={(e) => update("purpose", e.target.value as Purpose)}
              style={styles.input}
            >
              <option value="personal">Personal / Leisure</option>
              <option value="rideshare">Rideshare (Uber / Lyft)</option>
            </select>
          </Field>

          <Field label="Pickup date & time" required>
            <input
              type="datetime-local"
              value={form.pickupAt}
              onChange={(e) => update("pickupAt", e.target.value)}
              style={styles.input}
            />
          </Field>

          <Field label="Rental length (days)" required>
            <input
              type="number"
              min={1}
              value={form.days}
              onChange={(e) => update("days", Number(e.target.value))}
              style={styles.input}
            />
          </Field>

          <Field label="Type your name as signature" required>
            <input
              value={form.signature}
              onChange={(e) => update("signature", e.target.value)}
              style={styles.input}
              placeholder="Legal signature"
            />
          </Field>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          onClick={submit}
          disabled={loading}
          style={{ ...styles.button, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? "Processing…" : "Continue to Step 3"}
        </button>

        <p style={styles.footer}>
          Next: upload license + selfie, upload pickup exterior photos (GPS/time verified), then sign agreement and pay.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={styles.label}>
        {label} {required && <span style={{ color: "#dc2626" }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const styles: Record<string, any> = {
  page: { display: "flex", justifyContent: "center", padding: "40px 20px" },
  card: {
    width: "100%",
    maxWidth: 900,
    background: "#fff",
    borderRadius: 18,
    padding: 28,
    border: "1px solid #e5e7eb",
  },
  title: { margin: 0, fontSize: 30 },
  subtitle: { marginTop: 8, color: "#555" },
  notice: {
    marginTop: 18,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 16,
    fontSize: 14,
  },
  grid: {
    marginTop: 22,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
  },
  label: { fontSize: 13, fontWeight: 800, marginBottom: 6, display: "block" },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    fontSize: 14,
    background: "#fff",
  },
  button: {
    marginTop: 22,
    width: "100%",
    padding: "14px 18px",
    borderRadius: 12,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontWeight: 900,
    fontSize: 16,
    cursor: "pointer",
  },
  error: { marginTop: 14, color: "#b91c1c", fontWeight: 700 },
  footer: { marginTop: 12, fontSize: 12, color: "#6b7280", textAlign: "center" },
};