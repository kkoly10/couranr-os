export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function asSingle<T>(x: any): T | null {
  if (!x) return null;
  if (Array.isArray(x)) return (x[0] as T) ?? null;
  return x as T;
}

async function getUserFromRequest(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("Missing authorization token");
  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid or expired token");
  return data.user;
}

async function requireAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || (data as any)?.role !== "admin") {
    throw new Error("Admin access required");
  }
}

async function getEmailForUserId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  return (data as any)?.email ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const adminUser = await getUserFromRequest(req);
    await requireAdmin(adminUser.id);

    const body = await req.json().catch(() => ({}));
    const rentalId = body?.rentalId as string | undefined;
    const decision = body?.decision as "refunded" | "withheld" | undefined;
    const amountCents = Number(body?.amountCents ?? 0);
    const reason = (body?.reason ?? null) as string | null;

    if (!rentalId || !decision) {
      return NextResponse.json(
        { error: "Missing rentalId or decision" },
        { status: 400 }
      );
    }

    if (!["refunded", "withheld"].includes(decision)) {
      return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    }

    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return NextResponse.json({ error: "Invalid amountCents" }, { status: 400 });
    }

    // Load rental (NO profiles join)
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        paid,
        return_confirmed_at,
        deposit_refund_status,
        deposit_refund_amount_cents,
        damage_confirmed,
        damage_notes,
        vehicles:vehicles(id, year, make, model)
      `
      )
      .eq("id", rentalId)
      .maybeSingle();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Must be paid + return confirmed
    if (!rental.paid || !rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Requires: paid + return confirmed" },
        { status: 400 }
      );
    }

    // Prevent changing after decision
    if (rental.deposit_refund_status === "refunded" || rental.deposit_refund_status === "withheld") {
      return NextResponse.json(
        { error: "Deposit decision already completed" },
        { status: 400 }
      );
    }

    // ---- Damage gate: cannot withhold unless damage confirmed ----
    if (decision === "withheld" && !rental.damage_confirmed) {
      return NextResponse.json(
        { error: "Cannot withhold until damage is confirmed" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const nextStatus = decision;
    const withholdAmount = decision === "withheld" ? Math.max(0, Math.floor(amountCents)) : 0;

    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({
        deposit_refund_status: nextStatus,
        deposit_refund_amount_cents: withholdAmount,
      })
      .eq("id", rentalId);

    if (updErr) {
      return NextResponse.json({ error: "Failed to save deposit decision" }, { status: 500 });
    }

    // Audit event
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: adminUser.id,
      actor_role: "admin",
      event_type: "deposit_decision",
      event_payload: {
        decision,
        amountCents: withholdAmount,
        reason,
        at: now,
      },
    });

    // Email renter
    const renterEmail = await getEmailForUserId(rental.user_id);
    const v = asSingle<{ year?: any; make?: any; model?: any }>((rental as any).vehicles);
    const carLabel =
      v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "your rental vehicle";

    if (renterEmail && process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      const subject =
        decision === "refunded"
          ? "Deposit refunded — Couranr Auto"
          : "Deposit withheld — Couranr Auto (Damage confirmed)";

      const text =
        decision === "refunded"
          ? `Your deposit decision is complete for ${carLabel}.\n\nDeposit: REFUNDED\n\n— Couranr Auto`
          : `Your deposit decision is complete for ${carLabel}.\n\nDeposit: WITHHELD\nAmount: $${(withholdAmount / 100).toFixed(2)}\nReason: ${reason || rental.damage_notes || "Damage / cleaning / mileage"}\n\n— Couranr Auto`;

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: renterEmail,
        subject,
        text,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}