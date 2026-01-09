// app/auto/rent/[vehicleId]/page.tsx

import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import RentClient from "./RentClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: {
    vehicleId: string;
  };
};

export default async function RentVehiclePage({ params }: PageProps) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .select(`
      id,
      year,
      make,
      model,
      trim,
      color,
      daily_rate_cents,
      weekly_rate_cents,
      deposit_cents,
      status,
      image_urls
    `)
    .eq("id", params.vehicleId)
    .single();

  if (error || !vehicle) {
    notFound();
  }

  if (vehicle.status !== "available") {
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
        <h1>Vehicle not available</h1>
        <p>This vehicle is currently unavailable for rental.</p>
      </div>
    );
  }

  return <RentClient vehicle={vehicle} />;
}