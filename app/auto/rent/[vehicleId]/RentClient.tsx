"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function RentClient({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    licenseNumber: "",
    licenseState: "",
    licenseExpires: "", // YYYY-MM-DD

    purpose: "personal" as "personal" | "rideshare",

    days: 1,
    pickupAt: "",
    signature: "",
  });

  function update<K extends keyof typeof form>(key: K, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const requiredMissing = useMemo(() => {
    const missing: string[] = [];
    if (!form.fullName.trim()) missing.push("Full name");
    if (!form.email.trim()) missing.push("Email");
    if (!form.phone.trim()) missing.push("Phone");
    if (!form.licenseNumber.trim()) missing.push("Driver license #");
    if (!form.licenseState.trim()) missing.push("License state");
    if (!form.licenseExpires.trim()) missing.push("License expiration date");
    if (!form.pickupAt.trim()) missing.push("Pickup date & time");
    if (!form.signature.trim()) missing.push("Signature");
    if (!form.purpose) missing.push("Rental purpose");
    return missing;
  }, [form]);

  async function submit() {
    setError(null);

    if (requiredMissing.length > 0) {
      setError(`Missing required fields: ${requiredMissing.join(", ")}`);
      return;
    }

    setLoading(true);

    try {
      // ✅ Must include Bearer token (you were getting 401 earlier)
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;

      if (!token) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      const res = await fetch("/api/auto/create-rental", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehicleId,
          ...form,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create rental");
      }

      // ✅ Step C1: go to agreement next (NOT checkout yet)
      router.push(`/auto/agreement?rentalId=${encodeURIComponent(data.rentalId)}`);
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

        {/* Pickup rules */}
        <div style={styles.notice}>
          <strong>Pickup & pricing rules</strong>
          <ul style={{ marginTop: 6, paddingLeft: 18 }}>
            <li>
              Location: <strong>1090 Stafford Marketplace, VA 22556</strong>
            </li>
            <li>
              Hours: <strong>9:00 AM – 6:00 PM</strong>
            </li>
            <li>
              Minimum lead time: <strong>50 minutes</strong>
            </li>
            <li>Time rounded to the next 30-minute block</li>
            <li>Same-day rentals are charged the daily rate</li>
            <li>Weekly pricing starts at 7 days</li>
          </ul>
        </div>

        {/* Form */}
        <div style={styles.grid}>
          <Field label="Full name" required>
            <input
              value={form.fullName}
              onChange={(e) => update("fullName", e.target.value)}
              style={styles.input}
              placeholder="John Doe"
            />
          </Field>

          <Field label="Email" required>
            <input
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              style={styles.input}
              placeholder="you@email.com"
              inputMode="email"
            />
          </Field>

          <Field label="Phone number" required>
            <input
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              style={styles.input}
              placeholder="(555) 123-4567"
              inputMode="tel"
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
              onChange={(e) => update("licenseState", e.target.value.toUpperCase())}
              style={styles.input}
              placeholder="VA"
              maxLength={2}
            />
          </Field>

          <Field label="License expiration date" required>
            <input
              type="date"
              value={form.licenseExpires}
              onChange={(e) => update("licenseExpires", e.target.value)}
              style={styles.input}
            />
          </Field>

          <Field label="Rental purpose" required>
            <select
              value={form.purpose}
              onChange={(e) => update("purpose", e.target.value)}
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

          <Field label="Rental length (days)">
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
          style={{
            ...styles.button,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Processing…" : "Continue"}
        </button>

        <p style={styles.footer}>
          Next step: you’ll review and sign the rental agreement before payment.
        </p>
      </div>
    </div>
  );
}

/* ---------- UI helpers ---------- */

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

/* ---------- Styles ---------- */

const styles: Record<string, any> = {
  page: {
    display: "flex",
    justifyContent: "center",
    padding: "40px 20px",
  },
  card: {
    width: "100%",
    maxWidth: 920,
    background: "#fff",
    borderRadius: 18,
    padding: 28,
    border: "1px solid #e5e7eb",
  },
  title: {
    margin: 0,
    fontSize: 28,
  },
  subtitle: {
    marginTop: 6,
    color: "#555",
  },
  notice: {
    marginTop: 20,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
  },
  grid: {
    marginTop: 24,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 6,
    display: "block",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
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
    fontWeight: 800,
    fontSize: 16,
    cursor: "pointer",
  },
  error: {
    marginTop: 16,
    color: "#b91c1c",
    fontWeight: 700,
  },
  footer: {
    marginTop: 14,
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
};