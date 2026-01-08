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
  image_urls?: string[]; // ✅ ADD THIS
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

      <div
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        }}
      >
        {vehicles.map((v) => {
          const image =
            v.image_urls && v.image_urls.length > 0
              ? v.image_urls[0]
              : "/placeholder-car.jpg"; // optional fallback

          return (
            <div
              key={v.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 16,
                background: "#fff",
                overflow: "hidden",
              }}
            >
              {/* Vehicle Image */}
              <div style={{ height: 180, background: "#f3f4f6" }}>
                <img
                  src={image}
                  alt={`${v.year} ${v.make} ${v.model}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </div>

              {/* Vehicle Info */}
              <div style={{ padding: 16 }}>
                <h3 style={{ margin: "0 0 6px 0" }}>
                  {v.year} {v.make} {v.model}
                </h3>

                {v.trim && (
                  <p style={{ margin: 0, color: "#555" }}>{v.trim}</p>
                )}
                {v.color && (
                  <p style={{ margin: 0, color: "#555" }}>
                    Color: {v.color}
                  </p>
                )}

                <div style={{ marginTop: 12 }}>
                  <p>
                    <strong>Daily:</strong>{" "}
                    ${(v.daily_rate_cents / 100).toFixed(2)}
                  </p>
                  <p>
                    <strong>Weekly:</strong>{" "}
                    ${(v.weekly_rate_cents / 100).toFixed(2)}
                  </p>
                  <p>
                    <strong>Deposit:</strong>{" "}
                    ${(v.deposit_cents / 100).toFixed(2)}
                  </p>
                </div>

                <button
                  style={{
                    marginTop: 14,
                    width: "100%",
                    padding: "12px",
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
