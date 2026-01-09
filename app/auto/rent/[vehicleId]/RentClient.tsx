"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RentClient({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    license: "",
    days: 1,
    pickupAt: "",
    signature: "",
  });

  function update<K extends keyof typeof form>(key: K, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);

    if (!form.fullName || !form.phone || !form.license || !form.pickupAt || !form.signature) {
      setError("Please complete all required fields.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auto/create-rental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId,
          ...form,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create rental");
      }

      router.push(`/auto/checkout?rentalId=${data.rentalId}`);
    } catch (e: any) {
      setError(e.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Reserve this vehicle</h2>
        <p style={styles.subtitle}>
          Secure your rental in minutes. Payment confirms your reservation.
        </p>

        {/* Pickup rules */}
        <div style={styles.notice}>
          <strong>Pickup rules</strong>
          <ul style={{ marginTop: 6 }}>
            <li>Pickup & return location: <strong>1090 Stafford Marketplace, VA 22556</strong></li>
            <li>Hours: <strong>9:00 AM – 6:00 PM</strong></li>
            <li>Minimum lead time: <strong>50 minutes</strong></li>
            <li>Reservations are rounded to the next 30-minute block</li>
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
              value={form.license}
              onChange={(e) => update("license", e.target.value)}
              style={styles.input}
              placeholder="License number"
            />
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
          {loading ? "Processing…" : "Continue to payment"}
        </button>

        <p style={styles.footer}>
          By continuing, you agree to Couranr Auto rental terms.  
          Vehicle condition photos will be required after checkout.
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
    maxWidth: 820,
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
  },
  button: {
    marginTop: 28,
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
    fontWeight: 600,
  },
  footer: {
    marginTop: 14,
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
};