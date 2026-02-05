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

function asSingle<T>(val: any): T | null {
  if (!val) return null;
  if (Array.isArray(val)) return (val[0] as T) || null;
  return val as T;
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "");
    const decision = body?.decision === "withheld" ? "withheld" : body?.decision === "refunded" ? "refunded" : null;
    const amountCentsRaw = body?.amountCents;
    const reason = body?.reason ? String(body.reason).slice(0, 2000) : null;

    if (!rentalId || !decision) {
      return NextResponse.json({ error: "Missing rentalId or decision" }, { status: 400 });
    }

    let amountCents = 0;
    if (decision === "withheld") {
      const n = Number(amountCentsRaw);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "Invalid amountCents" }, { status: 400 });
      }
      amountCents = Math.round(n);
    }

    const supabase = svc();

    // Load rental
    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select(
        `
        id,status,paid,paid_at,return_confirmed_at,deposit_refund_status,deposit_refund_amount_cents,
        damage_confirmed,damage_confirmed_at,
        profiles:profiles(email),
        vehicles:vehicles(id, year, make, model)
      `
      )
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Enforce prerequisites
    if (!rental.paid) {
      return NextResponse.json({ error: "Cannot decide deposit: rental not marked paid." }, { status: 400 });
    }
    if (!rental.return_confirmed_at) {
      return NextResponse.json({ error: "Cannot decide deposit: return not confirmed." }, { status: 400 });
    }

    // Prevent double-finalization
    if (rental.deposit_refund_status === "refunded" || rental.deposit_refund_status === "withheld") {
      return NextResponse.json({ error: "Deposit already finalized for this rental." }, { status: 400 });
    }

    // 🔒 Damage gate: WITHHOLD requires damage_confirmed
    if (decision === "withheld" && !rental.damage_confirmed) {
      return NextResponse.json(
        { error: "Cannot withhold deposit until damage is confirmed (damage_confirmed=true)." },
        { status: 400 }
      );
    }

    const updatePayload: any = {
      deposit_refund_status: decision,
      deposit_refund_amount_cents: decision === "withheld" ? amountCents : 0,
    };

    const { error: uErr } = await supabase.from("rentals").update(updatePayload).eq("id", rentalId);
    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    // Audit event
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: null,
      actor_role: "admin",
      event_type: "deposit_decision",
      event_payload: {
        decision,
        amountCents: updatePayload.deposit_refund_amount_cents,
        reason,
        damage_confirmed: !!rental.damage_confirmed,
      },
    });

    // Optional: you can email the renter here later (we’ll do that in “B” properly)
    // Keep this route stable for now.

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 401 });
  }
}