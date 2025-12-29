import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabaseClient";

export async function GET() {
  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Role check
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "driver") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch driver deliveries
  const { data, error } = await supabase
    .from("deliveries")
    .select(`
      id,
      status,
      created_at,
      recipient_name,
      recipient_phone,
      estimated_miles,
      weight_lbs,
      pickup_address:addresses!deliveries_pickup_address_id_fkey (
        address_line,
        city,
        state,
        zip
      ),
      dropoff_address:addresses!deliveries_dropoff_address_id_fkey (
        address_line,
        city,
        state,
        zip
      )
    `)
    .eq("driver_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deliveries: data });
}