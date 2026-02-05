// app/api/auto/rental-summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function asSingle<T>(v: any): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);

    const url = new URL(req.url);
    const rentalId = String(url.searchParams.get("rentalId") || "").trim();

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        status,
        purpose,
        pickup_at,
        return_at,
        pickup_location,
        agreement_required,
        agreement_signed,
        docs_complete,
        paid,
        paid_at,
        verification_status,
        condition_photos_status,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at,
        deposit_refund_status,
        deposit_refund_amount_cents,
        damage_confirmed,
        damage_confirmed_at,
        damage_notes,
        created_at,
        vehicles:vehicles(id, year, make, model)
      `
      )
      .eq("id", rentalId)
      .eq("user_id", user.id)
      .single();

    if (error || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    const v = asSingle<{ year?: any; make?: any; model?: any }>(rental.vehicles);
    const carLabel = v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "Your rental vehicle";

    return NextResponse.json(
      {
        ok: true,
        rental: {
          ...rental,
          vehicle_label: carLabel,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}