export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { rentalId } = await req.json();
    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    // Fetch rental + renter email
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select(`
        id,
        user_id,
        pickup_confirmed_at,
        lockbox_code_released_at,
        paid,
        agreement_signed,
        profiles ( email )
      `)
      .eq("id", rentalId)
      .single();

    if (error || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Enforce pickup rules
    if (!rental.lockbox_code_released_at || !rental.paid || !rental.agreement_signed) {
      return NextResponse.json(
        { error: "Pickup prerequisites not met" },
        { status: 400 }
      );
    }

    if (rental.pickup_confirmed_at) {
      return NextResponse.json({ ok: true });
    }

    // Confirm pickup
    await supabaseAdmin
      .from("rentals")
      .update({ pickup_confirmed_at: new Date().toISOString() })
      .eq("id", rentalId);

    // Audit
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      event_type: "pickup_confirmed",
      event_payload: {},
    });

    // Email renter
    const email = rental.profiles?.email;
    if (email) {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: email,
        subject: "🚗 Pickup confirmed — your rental is now active",
        html: `
          <p>Your pickup has been confirmed.</p>
          <p>Your rental is now active.</p>
          <p>Please return the vehicle on time and in the same condition.</p>
          <p>Thank you for choosing Couranr Auto.</p>
        `,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Confirm pickup error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}