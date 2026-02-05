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

  if (error || (data as any)?.role !== "admin") throw new Error("Admin access required");
}

async function getEmailForUserId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  return (data as any)?.email ?? null;
}

/**
 * POST body:
 * {
 *   rentalId: string,
 *   type: string,          // e.g. "lockbox_released", "pickup_confirmed", "return_confirmed", "deposit_refunded", ...
 *   subject?: string,
 *   message?: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    await requireAdmin(user.id);

    const body = await req.json().catch(() => ({}));
    const rentalId = body?.rentalId as string | undefined;
    const type = body?.type as string | undefined;

    if (!rentalId || !type) {
      return NextResponse.json(
        { error: "Missing rentalId or type" },
        { status: 400 }
      );
    }

    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        status,
        purpose,
        paid,
        agreement_signed,
        docs_complete,
        verification_status,
        lockbox_code_released_at,
        pickup_confirmed_at,
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

    const renterEmail = await getEmailForUserId(rental.user_id);
    if (!renterEmail) {
      return NextResponse.json({ error: "Renter email not found" }, { status: 400 });
    }

    const v = asSingle<{ year?: any; make?: any; model?: any }>((rental as any).vehicles);
    const carLabel =
      v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "your rental vehicle";

    // Default subject/message
    const subject =
      (body?.subject as string | undefined) ||
      `[Couranr Auto] Update: ${type.replaceAll("_", " ")}`;

    const message =
      (body?.message as string | undefined) ||
      `Update for ${carLabel}\n\n` +
        `Status: ${rental.status}\n` +
        `Verification: ${rental.verification_status}\n` +
        `Agreement: ${rental.agreement_signed ? "signed" : "not signed"}\n` +
        `Paid: ${rental.paid ? "yes" : "no"}\n` +
        `Pickup confirmed: ${rental.pickup_confirmed_at ? "yes" : "no"}\n` +
        `Return confirmed: ${rental.return_confirmed_at ? "yes" : "no"}\n` +
        `Deposit: ${rental.deposit_refund_status}\n` +
        (rental.deposit_refund_status === "withheld"
          ? `Withheld: $${((rental.deposit_refund_amount_cents || 0) / 100).toFixed(2)}\n`
          : "") +
        (rental.damage_confirmed ? `Damage confirmed: YES\nNotes: ${rental.damage_notes || "—"}\n` : "");

    // Send email (Resend)
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      return NextResponse.json(
        { error: "Missing RESEND_API_KEY or RESEND_FROM_EMAIL" },
        { status: 500 }
      );
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: renterEmail,
      subject,
      text: message,
    });

    // Audit log
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "admin",
      event_type: "notify_sent",
      event_payload: { type, subject, to: renterEmail },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}