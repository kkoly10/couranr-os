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

    const { data: rentals, error } = await admin
      .from("rentals")
      .select(
        `
        id,user_id,vehicle_id,status,purpose,
        docs_complete,verification_status,agreement_signed,paid,
        lockbox_code_released_at,pickup_confirmed_at,return_confirmed_at,
        condition_photos_status,deposit_refund_status,damage_confirmed,
        created_at
      `
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const vehicleIds = Array.from(
      new Set((rentals || []).map((r: any) => r.vehicle_id).filter(Boolean))
    );

    let vehicleMap: Record<string, any> = {};
    if (vehicleIds.length) {
      const vRes = await admin
        .from("vehicles")
        .select("id,year,make,model")
        .in("id", vehicleIds);

      for (const v of vRes.data || []) vehicleMap[v.id] = v;
    }

    const enriched = (rentals || []).map((r: any) => ({
      ...r,
      vehicle: r.vehicle_id ? vehicleMap[r.vehicle_id] || null : null,
    }));

    return NextResponse.json({ rentals: enriched });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}