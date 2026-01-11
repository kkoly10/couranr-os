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
    licenseNumber: "",
    licenseState: "",
    days: 1,
    pickupAt: "",
    purpose: "personal",
    signature: "",
  });

  function update<K extends keyof typeof form>(key: K, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);

    const {
      fullName,
      phone,
      licenseNumber,
      licenseState,
      pickupAt,
      signature,
    } = form;

    if (
      !fullName ||
      !phone ||
      !licenseNumber ||
      !licenseState ||
      !pickupAt ||
      !signature
    ) {
      setError("Please complete all required fields.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auto/create-rental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId, ...form }),
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

          <Field label="License state" required>
            <select
              value={form.licenseState}
              onChange={(e) => update("licenseState", e.target.value)}
              style={styles.input}
            >
              <option value="">Select state</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
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

          <Field label="Signature (type full name)" required>
            <input
              value={form.signature}
              onChange={(e) => update("signature", e.target.value)}
              style={styles.input}
            />
          </Field>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button onClick={submit} disabled={loading} style={styles.button}>
          {loading ? "Processing…" : "Continue to payment"}
        </button>
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

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
];

const styles: Record<string, any> = {
  page: { display: "flex", justifyContent: "center", padding: 40 },
  card: { maxWidth: 900, width: "100%", border: "1px solid #e5e7eb", borderRadius: 16, padding: 28 },
  title: { fontSize: 28, marginBottom: 20 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 },
  label: { fontSize: 13, fontWeight: 700, marginBottom: 6 },
  input: { padding: 12, borderRadius: 10, border: "1px solid #d1d5db" },
  button: { marginTop: 24, padding: 14, borderRadius: 12, background: "#111827", color: "#fff", fontWeight: 800 },
  error: { marginTop: 16, color: "#b91c1c", fontWeight: 700 },
};