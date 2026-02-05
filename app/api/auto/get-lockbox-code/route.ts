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
    const { searchParams } = new URL(req.url);
    const rentalId = searchParams.get("rentalId");

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: rental, error } = await admin
      .from("rentals")
      .select("id,user_id,lockbox_code,lockbox_code_released_at")
      .eq("id", rentalId)
      .single();

    if (error || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (rental.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!rental.lockbox_code_released_at) {
      return NextResponse.json(
        { error: "Lockbox code not released yet" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      rentalId,
      lockboxCode: rental.lockbox_code || null,
      releasedAt: rental.lockbox_code_released_at,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}