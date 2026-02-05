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

    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select(`
        id,
        user_id,
        pickup_confirmed_at,
        return_confirmed_at,
        profiles ( email )
      `)
      .eq("id", rentalId)
      .single();

    if (error || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (!rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Pickup not confirmed yet" },
        { status: 400 }
      );
    }

    if (rental.return_confirmed_at) {
      return NextResponse.json({ ok: true });
    }

    // Confirm return
    await supabaseAdmin
      .from("rentals")
      .update({
        return_confirmed_at: new Date().toISOString(),
        deposit_refund_status: "pending",
      })
      .eq("id", rentalId);

    // Audit
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      event_type: "return_confirmed",
      event_payload: {},
    });

    // Email renter
    const email = rental.profiles?.email;
    if (email) {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: email,
        subject: "📦 Vehicle returned — deposit review in progress",
        html: `
          <p>We’ve received your vehicle.</p>
          <p>Our team is reviewing it now.</p>
          <p>Your deposit decision will be completed shortly.</p>
          <p>Thank you for renting with Couranr Auto.</p>
        `,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Confirm return error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}