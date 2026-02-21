export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const admin = adminClient();

    // We fetch the most recently UPDATED rental that is NOT cancelled
    const { data: rental, error } = await admin
      .from("rentals")
      .select(`
        id,user_id,vehicle_id,status,purpose,
        docs_complete,verification_status,agreement_signed,paid,
        lockbox_code_released_at,pickup_confirmed_at,return_confirmed_at,
        condition_photos_status,deposit_refund_status,damage_confirmed,
        created_at
      `)
      .eq("user_id", user.id)
      .neq("status", "cancelled")
      .order("paid", { ascending: false }) // Prioritize paid rentals
      .order("created_at", { ascending: false }) // Then by newest
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    let vehicle: any = null;
    if (rental?.vehicle_id) {
      const vRes = await admin
        .from("vehicles")
        .select("id,year,make,model")
        .eq("id", rental.vehicle_id)
        .single();
      vehicle = vRes.data || null;
    }

    return NextResponse.json({ rental: rental || null, vehicle });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
