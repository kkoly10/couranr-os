// app/api/auto/sign-agreement/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));

    const rentalId = String(body?.rentalId || "").trim();
    const signedName = String(body?.signedName || body?.signatureName || "").trim(); // accept both

    if (!rentalId) return jsonError("Missing rentalId");

    // IMPORTANT: service role bypasses RLS -> we must enforce auth here
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id,user_id,renter_id,agreement_required,agreement_signed,status,docs_complete")
      .eq("id", rentalId)
      .single();

    if (error || !rental) return jsonError("Rental not found", 404);

    // Allow renter or owner to sign (prevents leakage/abuse)
    const allowed = rental.renter_id === user.id || rental.user_id === user.id;
    if (!allowed) return jsonError("Forbidden", 403);

    // Optional safety gate: require docs before agreement
    if (!rental.docs_complete) {
      return jsonError("Verification documents are required before signing.", 409);
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
      .eq("id", rentalId);

    if (updErr) return jsonError(updErr.message, 400);

    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: rental.renter_id === user.id ? "renter" : "owner",
      event_type: "agreement_signed",
      event_payload: { signature_name: signedName || null },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return jsonError(e?.message || "Server error", 500);
  }
}