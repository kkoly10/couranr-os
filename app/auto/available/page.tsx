import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Vehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  color: string | null;
  daily_rate_cents: number;
  weekly_rate_cents: number;
  deposit_cents: number;
  status: string;
  image_urls: string[] | null;
};

export default async function AvailableCarsPage() {
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("status", "available")
    .order("created_at", { ascending: true });

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Error loading vehicles</h2>
        <pre>{error.message}</pre>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Available Vehicles</h1>
          <p style={{ marginTop: 8, color: "#555" }}>
            Choose a vehicle and start the booking flow.
          </p>
        </div>
        <Link
          href="/auto"
          style={{
            alignSelf: "center",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            textDecoration: "none",
            fontWeight: 800,
            color: "#111827",
            background: "#fff",
          }}
        >
          How rentals work
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 20,
          marginTop: 24,
        }}
      >
        {vehicles?.map((v: Vehicle) => {
          const image = v.image_urls?.[0] ?? null;

          return (
            <div
              key={v.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                overflow: "hidden",
                background: "#fff",
              }}
            >
              {image ? (
                <img
                  src={image}
                  alt={`${v.year} ${v.make} ${v.model}`}
                  style={{ width: "100%", height: 200, objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    height: 200,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f3f4f6",
                    color: "#6b7280",
                  }}
                >
                  No image yet
                </div>
              )}

              <div style={{ padding: 16 }}>
                <h3 style={{ margin: 0 }}>
                  {v.year} {v.make} {v.model}
                </h3>

                {v.trim && <p style={{ margin: "4px 0", color: "#555" }}>{v.trim}</p>}

                <p style={{ marginTop: 10 }}>
                  <strong>${(v.daily_rate_cents / 100).toFixed(0)}</strong> / day •{" "}
                  <strong>${(v.weekly_rate_cents / 100).toFixed(0)}</strong> / week
                </p>

                <p style={{ marginTop: 8, color: "#555" }}>
                  Deposit:{" "}
                  {v.deposit_cents > 0 ? `$${(v.deposit_cents / 100).toFixed(0)}` : "No deposit"}
                </p>

                <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                  <Link
                    href={`/auto/rent/${v.id}`}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: "#111827",
                      color: "#fff",
                      textDecoration: "none",
                      fontWeight: 900,
                    }}
                  >
                    Rent this car
                  </Link>

                  <Link
                    href={`/auto/rent/${v.id}`}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid #111827",
                      color: "#111827",
                      textDecoration: "none",
                      fontWeight: 900,
                      background: "#fff",
                    }}
                  >
                    View details
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}