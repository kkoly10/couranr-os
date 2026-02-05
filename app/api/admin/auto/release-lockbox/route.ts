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
    const user = await getUserFromRequest(req);
    await requireAdmin(user.id);

    const body = await req.json().catch(() => ({}));
    const rentalId = body?.rentalId as string | undefined;
    const lockboxCode = body?.lockboxCode as string | undefined;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    if (!lockboxCode || String(lockboxCode).trim().length < 2) {
      return NextResponse.json({ error: "Missing lockboxCode" }, { status: 400 });
    }

    // Load rental + vehicle (NO profiles join)
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        approval_status,
        paid,
        agreement_signed,
        docs_complete,
        verification_status,
        lockbox_code_released_at,
        lockbox_code,
        vehicle_id,
        vehicles:vehicles(id, year, make, model)
      `
      )
      .eq("id", rentalId)
      .maybeSingle();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // ---- FIX 2: Lockbox release enforcement (must be all green) ----
    if (rental.lockbox_code_released_at) {
      return NextResponse.json(
        { ok: true, message: "Lockbox already released" },
        { status: 200 }
      );
    }

    if (rental.approval_status !== "approved") {
      return NextResponse.json({ error: "Rental not approved yet" }, { status: 400 });
    }

    if (rental.verification_status !== "approved") {
      return NextResponse.json({ error: "Verification not approved" }, { status: 400 });
    }

    if (!rental.docs_complete) {
      return NextResponse.json({ error: "Docs not complete" }, { status: 400 });
    }

    if (!rental.agreement_signed) {
      return NextResponse.json({ error: "Agreement not signed" }, { status: 400 });
    }

    if (!rental.paid) {
      return NextResponse.json({ error: "Payment not received" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Release lockbox
    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({
        lockbox_code: String(lockboxCode).trim(),
        lockbox_code_released_at: now,
      })
      .eq("id", rentalId);

    if (updErr) {
      return NextResponse.json({ error: "Failed to release lockbox" }, { status: 500 });
    }

    // Audit
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "admin",
      event_type: "lockbox_released",
      event_payload: { at: now },
    });

    // Email renter pickup instructions
    const renterEmail = await getEmailForUserId(rental.user_id);
    const v = asSingle<{ year?: any; make?: any; model?: any }>((rental as any).vehicles);
    const carLabel =
      v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "your rental vehicle";

    if (
      renterEmail &&
      process.env.RESEND_API_KEY &&
      process.env.RESEND_FROM_EMAIL
    ) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      const pickupLocation = (rental as any).pickup_location || "See your dashboard for pickup details";

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: renterEmail,
        subject: "Approved — pickup instructions + lockbox code (Couranr Auto)",
        text:
          `You're approved for ${carLabel}.\n\n` +
          `Pickup location: ${pickupLocation}\n` +
          `Lockbox code: ${String(lockboxCode).trim()}\n\n` +
          `Next steps:\n` +
          `1) Go to your renter dashboard\n` +
          `2) Upload required pickup photos\n` +
          `3) Confirm pickup when prompted\n\n` +
          `— Couranr Auto`,
      });
    }

    return NextResponse.json({ ok: true, released_at: now });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}