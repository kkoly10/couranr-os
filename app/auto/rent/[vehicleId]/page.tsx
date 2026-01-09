import { createClient } from "@supabase/supabase-js";
import RentClient from "./RentClient";

export default async function RentVehiclePage({
  params,
}: {
  params: { vehicleId: string };
}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 1️⃣ Fetch vehicle for display (server-side)
  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", params.vehicleId)
    .single();

  if (error || !vehicle) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Vehicle not found</h2>
        <p>Please go back and select another vehicle.</p>
      </div>
    );
  }

  // 2️⃣ Render client form with ONLY vehicleId
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>
        Rent {vehicle.year} {vehicle.make} {vehicle.model}
      </h1>

      {vehicle.image_urls?.length > 0 && (
        <img
          src={vehicle.image_urls[0]}
          alt={`${vehicle.make} ${vehicle.model}`}
          style={{
            width: "100%",
            maxHeight: 360,
            objectFit: "cover",
            borderRadius: 12,
            marginBottom: 20,
          }}
        />
      )}

      <p>
        <strong>Daily:</strong> ${(vehicle.daily_rate_cents / 100).toFixed(2)} <br />
        <strong>Weekly:</strong> ${(vehicle.weekly_rate_cents / 100).toFixed(2)} <br />
        <strong>Deposit:</strong> ${(vehicle.deposit_cents / 100).toFixed(2)}
      </p>

      <hr style={{ margin: "24px 0" }} />

      {/* ✅ Correct prop */}
      <RentClient vehicleId={vehicle.id} />
    </div>
  );
}