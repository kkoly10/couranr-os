// app/api/admin/auto/set-lockbox/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));

    const rentalId = String(body?.rentalId || "").trim();
    const code = String(body?.code || "").trim();

    if (!rentalId || !code) {
      return NextResponse.json({ error: "Missing rentalId or code" }, { status: 400 });
    }

    // Ensure rental exists
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select("id,status,lockbox_code_released_at")
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Safety: if already released, don't allow changing code here.
    if (rental.lockbox_code_released_at) {
      return NextResponse.json(
        { error: "Lockbox already released. Use admin tools carefully." },
        { status: 400 }
      );
    }

    // ONLY set the code. DO NOT set lockbox_code_released_at here.
    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({ lockbox_code: code })
      .eq("id", rentalId);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    // Audit
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: admin.id,
      actor_role: "admin",
      event_type: "lockbox_code_set",
      event_payload: { note: "Code stored (not released)" },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}