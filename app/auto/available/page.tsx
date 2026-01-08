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
      <h1>Available Vehicles</h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 20,
          marginTop: 24,
        }}
      >
        {vehicles?.map((v: Vehicle) => {
          const image =
            v.image_urls && v.image_urls.length > 0
              ? v.image_urls[0]
              : null;

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
                  style={{
                    width: "100%",
                    height: 200,
                    objectFit: "cover",
                  }}
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
                  No image
                </div>
              )}

              <div style={{ padding: 16 }}>
                <h3 style={{ margin: 0 }}>
                  {v.year} {v.make} {v.model}
                </h3>

                {v.trim && (
                  <p style={{ margin: "4px 0", color: "#555" }}>
                    {v.trim}
                  </p>
                )}

                <p style={{ marginTop: 10 }}>
                  <strong>${(v.daily_rate_cents / 100).toFixed(0)}</strong> / day
                </p>

                <p>
                  <strong>${(v.weekly_rate_cents / 100).toFixed(0)}</strong> / week
                </p>

                {v.deposit_cents > 0 ? (
                  <p>Deposit: ${(v.deposit_cents / 100).toFixed(0)}</p>
                ) : (
                  <p>No deposit required</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}