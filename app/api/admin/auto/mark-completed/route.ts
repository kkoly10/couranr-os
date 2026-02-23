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
    const adminUser = (await requireAdmin(req)) as any;

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "").trim();

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const supabase = svc();

    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select("id,status,paid,return_confirmed_at,deposit_refund_status")
      .eq("id", rentalId)
      .maybeSingle();

    if (rErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    const status = String(rental.status || "").toLowerCase();
    const depositStatus = String(rental.deposit_refund_status || "").toLowerCase();

    if (status === "completed") {
      return NextResponse.json({ ok: true, note: "Rental already completed" });
    }

    if (status === "cancelled") {
      return NextResponse.json({ error: "Cancelled rentals cannot be marked completed" }, { status: 400 });
    }

    if (!rental.return_confirmed_at) {
      return NextResponse.json({ error: "Cannot complete: return not confirmed yet" }, { status: 400 });
    }

    // Final deposit states only
    const finalDepositStates = new Set(["refunded", "withheld", "n/a"]);
    if (!finalDepositStates.has(depositStatus)) {
      return NextResponse.json(
        { error: "Cannot complete: finalize deposit decision first (refund/withhold)." },
        { status: 400 }
      );
    }

    const { error: uErr } = await supabase
      .from("rentals")
      .update({ status: "completed" })
      .eq("id", rentalId);

    if (uErr) {
      return NextResponse.json({ error: uErr.message || "Failed to mark completed" }, { status: 500 });
    }

    // Non-fatal audit event
    try {
      await supabase.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: adminUser?.id ?? null,
        actor_role: "admin",
        event_type: "rental_completed",
        event_payload: { at: new Date().toISOString() },
      });
    } catch (e) {
      console.error("Failed to insert rental_completed event", e);
    }

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      msg.includes("Missing authorization") || msg.includes("Invalid or expired token")
        ? 401
        : msg.includes("Admin access required")
        ? 403
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}