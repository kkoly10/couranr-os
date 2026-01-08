"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Vehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  color?: string;
  daily_rate_cents: number;
  weekly_rate_cents: number;
  deposit_cents: number;
  status: string;
};

export default function AvailableVehiclesPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/auto/vehicles");
        if (!res.ok) throw new Error("Failed to load vehicles");
        const data = await res.json();
        setVehicles(data.vehicles || []);
      } catch (e: any) {
        setError(e.message || "Error loading vehicles");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 32 }}>Available Cars</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Select a vehicle to start your rental.
      </p>

      {loading && <p>Loading vehicles…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {!loading && vehicles.length === 0 && (
        <p>No vehicles available at the moment.</p>
      )}

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {vehicles.map((v) => (
          <div
            key={v.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              background: "#fff",
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              {v.year} {v.make} {v.model}
            </h3>

            {v.trim && <p>{v.trim}</p>}
            {v.color && <p>Color: {v.color}</p>}

            <p><strong>Daily:</strong> ${(v.daily_rate_cents / 100).toFixed(2)}</p>
            <p><strong>Weekly:</strong> ${(v.weekly_rate_cents / 100).toFixed(2)}</p>
            <p><strong>Deposit:</strong> ${(v.deposit_cents / 100).toFixed(2)}</p>

            <button
              style={{
                marginTop: 12,
                width: "100%",
                padding: "10px",
                borderRadius: 10,
                border: "none",
                background: "#111827",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
              onClick={() => router.push(`/auto/rent/${v.id}`)}
            >
              Rent this car
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}