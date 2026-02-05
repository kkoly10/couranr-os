export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/app/lib/auth";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "");
    const damageConfirmed = Boolean(body?.damageConfirmed);
    const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const supabase = svc();

    // Load rental (admin)
    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select(
        "id,status,paid,return_confirmed_at,deposit_refund_status,damage_confirmed,damage_confirmed_at"
      )
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Enforce: you only confirm damage after return is confirmed
    if (!rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Return must be confirmed before damage review." },
        { status: 400 }
      );
    }

    // If deposit already finalized, do not allow changing damage state
    if (rental.deposit_refund_status === "refunded" || rental.deposit_refund_status === "withheld") {
      return NextResponse.json(
        { error: "Deposit already finalized. Cannot change damage state." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const updatePayload: any = {
      damage_confirmed: damageConfirmed,
      damage_notes: notes,
      damage_confirmed_at: damageConfirmed ? now : null,
    };

    const { error: uErr } = await supabase
      .from("rentals")
      .update(updatePayload)
      .eq("id", rentalId);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    // Audit log
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: null,
      actor_role: "admin",
      event_type: damageConfirmed ? "damage_confirmed" : "damage_cleared",
      event_payload: {
        notes,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 401 });
  }
}