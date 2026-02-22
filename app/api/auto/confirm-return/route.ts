// app/api/auto/confirm-return/route.ts
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
        pickup_confirmed_at,
        return_confirmed_at,
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

    // Must have pickup confirmed before return
    if (!rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Pickup not confirmed yet" },
        { status: 400 }
      );
    }

    // FIX: Relaxed photo gating to prevent customers from getting stuck on Step 9
    // As long as they have started the return phase (exterior or complete), let them finish.
    const okReturnPhotos =
      rental.condition_photos_status === "return_exterior_done" ||
      rental.condition_photos_status === "return_interior_done" ||
      rental.condition_photos_status === "complete";

    if (!okReturnPhotos) {
      return NextResponse.json(
        { error: "Return photos not complete yet. Please upload exterior and interior photos." },
        { status: 400 }
      );
    }

    if (rental.return_confirmed_at) {
      return NextResponse.json(
        { ok: true, message: "Return already confirmed" },
        { status: 200 }
      );
    }

    const now = new Date().toISOString();

    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({
        return_confirmed_at: now,
        status: "returned",
        deposit_refund_status: "pending", // deposit now under review
      })
      .eq("id", rentalId);

    if (updErr) {
      return NextResponse.json(
        { error: "Failed to confirm return" },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "return_confirmed",
      event_payload: { at: now },
    });

    // Email renter (Wrapped in Try/Catch so a failed email doesn't crash the return!)
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
            subject: "Return confirmed — deposit under review (Couranr Auto)",
            text:
              `Your return has been confirmed for ${carLabel}.\n\n` +
              `Damage review (if any) and deposit decision is now pending.\n\n` +
              `— Couranr Auto`,
          });
        }
      } catch (emailErr) {
        console.error("Email failed to send, but return was successfully confirmed.", emailErr);
      }
    }

    return NextResponse.json({ ok: true, return_confirmed_at: now });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
