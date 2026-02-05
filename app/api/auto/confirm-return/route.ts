export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { getUserFromRequest } from "@/app/lib/auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function getProfileEmail(admin: any, userId: string) {
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  return (data?.email as string | null) ?? null;
}

async function getVehicleLabel(admin: any, vehicleId: string | null) {
  if (!vehicleId) return "your rental vehicle";
  const { data } = await admin
    .from("vehicles")
    .select("year,make,model")
    .eq("id", vehicleId)
    .single();
  if (!data) return "your rental vehicle";
  return `${data.year} ${data.make} ${data.model}`.trim();
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const rentalId = body?.rentalId as string | undefined;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const admin = adminClient();

    // Load rental (NO joins)
    const { data: rental, error: rErr } = await admin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        vehicle_id,
        status,
        paid,
        agreement_signed,
        docs_complete,
        verification_status,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at,
        condition_photos_status,
        deposit_refund_status,
        damage_confirmed
      `
      )
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Ownership enforcement
    if (rental.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // State guards
    if (!rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Pickup must be confirmed before return" },
        { status: 400 }
      );
    }

    if (rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Return already confirmed" },
        { status: 400 }
      );
    }

    // Enforce return photos completed before confirming return
    const okReturnPhotos =
      rental.condition_photos_status === "return_interior_done" ||
      rental.condition_photos_status === "complete";

    if (!okReturnPhotos) {
      return NextResponse.json(
        { error: "Return photos required before confirming return" },
        { status: 400 }
      );
    }

    // Update rental return confirmation
    const now = new Date().toISOString();

    const { error: uErr } = await admin
      .from("rentals")
      .update({
        return_confirmed_at: now,
        status: "returned",
        deposit_refund_status:
          rental.deposit_refund_status && rental.deposit_refund_status !== "n/a"
            ? rental.deposit_refund_status
            : "pending",
      })
      .eq("id", rentalId);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 400 });
    }

    // Audit event
    await admin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "return_confirmed",
      event_payload: { at: now },
    });

    // Email renter (optional)
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;

    if (resendKey && fromEmail) {
      const renterEmail = await getProfileEmail(admin, rental.user_id);
      if (renterEmail) {
        const carLabel = await getVehicleLabel(admin, rental.vehicle_id ?? null);
        const resend = new Resend(resendKey);

        await resend.emails.send({
          from: fromEmail,
          to: renterEmail,
          subject: "Return confirmed — Couranr Auto",
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.5">
              <h2 style="margin:0 0 10px 0">Return confirmed ✅</h2>
              <p>We received your return confirmation for <strong>${carLabel}</strong>.</p>
              <p>Your deposit is now <strong>under review</strong>. We’ll notify you once the decision is made.</p>
              <p style="color:#6b7280;font-size:12px;margin-top:18px">
                Rental ID: ${rentalId}
              </p>
            </div>
          `,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}