// app/api/auto/confirm-pickup/route.ts
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
    const body = await req.json().catch(() => ({}));
    const rentalId = body?.rentalId as string | undefined;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(`
        id,
        user_id,
        status,
        paid,
        agreement_signed,
        docs_complete,
        verification_status,
        lockbox_code_released_at,
        pickup_confirmed_at,
        condition_photos_status,
        vehicle_id,
        vehicles:vehicles(id, year, make, model)
      `)
      .eq("id", rentalId)
      .maybeSingle();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (rental.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!rental.lockbox_code_released_at) {
      return NextResponse.json({ error: "Lockbox not released yet" }, { status: 400 });
    }

    // Gating check: Matches our smart status upgrading logic
    const okPickupPhotos =
      rental.condition_photos_status === "pickup_interior_done" ||
      rental.condition_photos_status === "return_exterior_done" ||
      rental.condition_photos_status === "return_interior_done" ||
      rental.condition_photos_status === "complete";

    if (!okPickupPhotos) {
      return NextResponse.json({ error: "Pickup photos not complete yet. Please upload exterior and interior photos." }, { status: 400 });
    }

    if (rental.pickup_confirmed_at) {
      return NextResponse.json({ ok: true, message: "Pickup already confirmed" }, { status: 200 });
    }

    const now = new Date().toISOString();
    
    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({
        pickup_confirmed_at: now,
        status: "active",
      })
      .eq("id", rentalId);

    if (updErr) {
      return NextResponse.json({ error: "Failed to confirm pickup" }, { status: 500 });
    }

    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "pickup_confirmed",
      event_payload: { at: now },
    });

    // 🚨 THE FIX: Wrapped Email in Try/Catch so it doesn't crash the confirmation
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const renterEmail = await getEmailForUserId(rental.user_id);
        if (renterEmail) {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const v = asSingle<{ year?: any; make?: any; model?: any }>((rental as any).vehicles);
          const carLabel = v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "your rental vehicle";

          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: renterEmail,
            subject: "Pickup confirmed — Couranr Auto",
            text: `Your pickup has been confirmed for ${carLabel}.\n\nDrive safe.\n\n— Couranr Auto`,
          });
        }
      } catch (emailErr) {
        console.error("Email failed to send, but pickup was successfully confirmed.", emailErr);
      }
    }

    return NextResponse.json({ ok: true, pickup_confirmed_at: now });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
