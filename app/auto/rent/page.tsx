import Link from "next/link";

type Vehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  daily_rate_cents: number;
  weekly_rate_cents: number;
  deposit_cents: number;
  status: string;
};

async function getVehicles(): Promise<Vehicle[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/auto/vehicles`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return data.vehicles || [];
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AutoRentListPage() {
  const vehicles = await getVehicles();

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 30, margin: 0 }}>Available cars</h1>
      <p style={{ marginTop: 8, color: "#444" }}>
        Choose a vehicle to start your rental request.
      </p>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        {vehicles.map((v) => (
          <div key={v.id} style={card}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>
              {v.year} {v.make} {v.model} {v.trim ? `(${v.trim})` : ""}
            </div>
            <div style={{ marginTop: 8, color: "#555" }}>
              Daily: <strong>{money(v.daily_rate_cents)}</strong> • Weekly:{" "}
              <strong>{money(v.weekly_rate_cents)}</strong>
              <br />
              Deposit: <strong>{money(v.deposit_cents)}</strong>
            </div>

            <div style={{ marginTop: 10, color: v.status === "available" ? "#166534" : "#b91c1c", fontWeight: 800 }}>
              Status: {v.status}
            </div>

            <div style={{ marginTop: 12 }}>
              {v.status === "available" ? (
                <Link href={`/auto/rent/${v.id}`} style={btnPrimary}>
                  Rent this car
                </Link>
              ) : (
                <span style={{ color: "#6b7280" }}>Not available</span>
              )}
            </div>
          </div>
        ))}

        {vehicles.length === 0 && (
          <div style={card}>
            <strong>No vehicles found.</strong>
            <p style={{ marginTop: 6, color: "#555" }}>
              Add vehicles in Supabase table <code>vehicles</code>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 16,
  background: "#fff",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 14px",
  borderRadius: 10,
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  textDecoration: "none",
};