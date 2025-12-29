import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("deliveries")
      .select(`
        id,
        status,
        created_at,
        driver_id,
        recipient_name,
        recipient_phone,
        estimated_miles,
        weight_lbs,

        orders (
          id,
          order_number,
          status,
          total_cents
        ),

        pickup_address:addresses!deliveries_pickup_address_id_fkey (
          address_line,
          city,
          state
        ),

        dropoff_address:addresses!deliveries_dropoff_address_id_fkey (
          address_line,
          city,
          state
        )
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ deliveries: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load deliveries" },
      { status: 500 }
    );
  }
}