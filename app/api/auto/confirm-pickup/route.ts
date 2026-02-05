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

    // Load rental (NO joins!)
    const { data: rental, error: rErr } = await admin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        vehicle_id,
        status,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at,
        condition_photos_status,
        condition_photos_complete,
        paid,
        agreement_signed,
        docs_complete,
        verification_status
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

    // Guards
    if (!rental.lockbox_code_released_at) {
      return NextResponse.json(
        { error: "Lockbox not released yet" },
        { status: 400 }
      );
    }

    if (rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Pickup already confirmed" },
        { status: 400 }
      );
    }

    if (rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Rental already returned" },
        { status: 400 }
      );
    }

    const pickupPhotosOk =
      rental.condition_photos_complete === true ||
      rental.condition_photos_status === "pickup_interior_done" ||
      rental.condition_photos_status === "complete";

    if (!pickupPhotosOk) {
      return NextResponse.json(
        { error: "Pickup photos must be completed before confirming pickup" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // Confirm pickup
    const nextStatus =
      rental.status === "approved" || rental.status === "reserved"
        ? "active"
        : rental.status;

    const { error: uErr } = await admin
      .from("rentals")
      .update({
        pickup_confirmed_at: now,
        status: nextStatus,
      })
      .eq("id", rentalId);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 400 });
    }

    // Audit
    await admin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "pickup_confirmed",
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
          subject: "Pickup confirmed — Couranr Auto",
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.5">
              <h2 style="margin:0 0 10px 0">Pickup confirmed ✅</h2>
              <p>Your pickup is confirmed for <strong>${carLabel}</strong>.</p>
              <p>Please drive safely and follow the rental agreement.</p>
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