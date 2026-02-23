// app/api/auto/get-lockbox-code/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

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

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const rentalId = searchParams.get("rentalId");

    if (!rentalId) {
      return NextResponse.json(
        { error: "Missing rentalId" },
        { status: 400, headers: noStoreHeaders }
      );
    }

    const admin = adminClient();

    const { data: rental, error } = await admin
      .from("rentals")
      .select("id,user_id,renter_id,lockbox_code,lockbox_code_released_at,status")
      .eq("id", rentalId)
      .single();

    if (error || !rental) {
      return NextResponse.json(
        { error: "Rental not found" },
        { status: 404, headers: noStoreHeaders }
      );
    }

    // Support either user_id or renter_id ownership (covers mixed/older rows)
    const ownerId = (rental as any).user_id || (rental as any).renter_id;
    if (ownerId !== user.id) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: noStoreHeaders }
      );
    }

    if (!rental.lockbox_code_released_at) {
      return NextResponse.json(
        { error: "Lockbox code not released yet" },
        { status: 403, headers: noStoreHeaders }
      );
    }

    const code = rental.lockbox_code ? String(rental.lockbox_code) : null;
    if (!code) {
      return NextResponse.json(
        { error: "Lockbox code is missing on this rental" },
        { status: 409, headers: noStoreHeaders }
      );
    }

    // Return BOTH keys for compatibility:
    // - AccessClient expects `code`
    // - older callers may expect `lockboxCode`
    return NextResponse.json(
      {
        rentalId,
        code,
        lockboxCode: code,
        releasedAt: rental.lockbox_code_released_at,
        status: rental.status ?? null,
      },
      { headers: noStoreHeaders }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: noStoreHeaders }
    );
  }
}