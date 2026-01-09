"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function RentClient({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    licenseNumber: "",
    days: 1,
    pickupAt: "",
    purpose: "personal", // personal | rideshare
    signature: "",
  });

  // 🔐 Ensure session exists before allowing submit
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.push(
          `/login?next=${encodeURIComponent(window.location.pathname)}`
        );
      } else {
        setSessionReady(true);
      }
    });
  }, [router]);

  function update<K extends keyof typeof form>(key: K, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);

    if (
      !form.fullName ||
      !form.phone ||
      !form.licenseNumber ||
      !form.pickupAt ||
      !form.signature
    ) {
      setError("Please complete all required fields.");
      return;
    }

    setLoading(true);

    try {
      // 🔐 GET SESSION TOKEN
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Authentication expired. Please log in again.");
      }

      const res = await fetch("/api/auto/create-rental", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          vehicleId,
          ...form,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create rental");
      }

      router.push(`/auto/confirmation?rentalId=${data.rentalId}`);
    } catch (e: any) {
      setError(e.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  if (!sessionReady) {
    return <p style={{ padding: 24 }}>Checking authentication…</p>;
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Reserve this vehicle</h2>
        <p style={styles.subtitle}>
          Verification, agreement, and payment come next.
        </p>

        {/* Rules */}
        <div style={styles.notice}>
          <strong>Pickup & pricing rules</strong>
          <ul style={{ marginTop: 6 }}>
            <li>Location: <strong>1090 Stafford Marketplace, VA 22556</strong></li>
            <li>Hours: <strong>9:00 AM – 6:00 PM</strong></li>
            <li>Minimum lead time: <strong>50 minutes</strong></li>
            <li>Time rounded to next 30-minute block</li>
            <li>Same-day rentals charged daily</li>
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
            />
          </Field>

          <Field label="Phone number" required>
            <input
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              style={styles.input}
            />
          </Field>

          <Field label="Driver license #" required>
            <input
              value={form.licenseNumber}
              onChange={(e) => update("licenseNumber", e.target.value)}
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
            />
          </Field>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          onClick={submit}
          disabled={loading}
          style={{ ...styles.button, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? "Processing…" : "Continue to payment"}
        </button>

        <p style={styles.footer}>
          By continuing, you agree to Couranr Auto rental terms and policies.
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
    maxWidth: 860,
    background: "#fff",
    borderRadius: 18,
    padding: 28,
    border: "1px solid #e5e7eb",
  },
  title: { margin: 0, fontSize: 28 },
  subtitle: { marginTop: 6, color: "#555" },
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
  label: { fontSize: 13, fontWeight: 700, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
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
    cursor: "pointer",
  },
  error: { marginTop: 16, color: "#b91c1c", fontWeight: 600 },
  footer: {
    marginTop: 14,
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
};