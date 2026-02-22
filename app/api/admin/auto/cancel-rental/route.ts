// app/api/admin/auto/cancel-rental/route.ts
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
    const reason = body?.reason || "Cancelled by administrator.";

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    // 1. Fetch the rental
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(`id, user_id, status, pickup_confirmed_at, return_confirmed_at, vehicles(year, make, model)`)
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // SAFETY GUARD: Do not allow cancellation if the rental is already in progress or completed
    if (rental.return_confirmed_at || rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Cannot cancel a rental after the car has been picked up. Please use the return/deposit flow." }, 
        { status: 400 }
      );
    }

    if (rental.status === "cancelled") {
      return NextResponse.json({ ok: true, message: "Already cancelled" }, { status: 200 });
    }

    // 2. Update status to 'cancelled'
    const now = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({ status: "cancelled" })
      .eq("id", rentalId);

    if (updErr) throw new Error("Failed to cancel rental in database.");

    // 3. Log the cancellation
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "admin",
      event_type: "rental_cancelled",
      event_payload: { at: now, reason },
    });

    // 4. Email the Customer
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
            subject: "Rental Cancelled (Couranr Auto)",
            text: `Your rental for ${carLabel} has been cancelled.\n\nReason: ${reason}\n\nIf you have already paid, any applicable refunds will be processed to your original payment method within 3-5 business days.\n\n— Couranr Auto Support`,
          });
        }
      } catch (emailErr) {
        console.error("Email failed to send, but rental was cancelled.");
      }
    }

    return NextResponse.json({ ok: true, cancelled_at: now });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
