// app/api/auto/sign-agreement/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));

    const rentalId = String(body?.rentalId || "").trim();

    // ✅ accept either name (your UI uses signedName right now)
    const signatureName =
      String(body?.signedName || body?.signatureName || "").trim() || null;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id,user_id,agreement_required,agreement_signed,status")
      .eq("id", rentalId)
      .eq("user_id", user.id)
      .single();

    if (error || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (!rental.agreement_required) {
      return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
    }

    if (rental.agreement_signed) {
      return NextResponse.json({ ok: true, alreadySigned: true }, { status: 200 });
    }

    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({ agreement_signed: true })
      .eq("id", rentalId)
      .eq("user_id", user.id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "agreement_signed",
      event_payload: { signature_name: signatureName },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}