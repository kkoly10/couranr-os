export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getUserFromRequest } from "@/lib/auth";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rentalId } = await req.json();
    if (!rentalId) {
      return NextResponse.json(
        { error: "Missing rentalId" },
        { status: 400 }
      );
    }

    // Load rental + renter email (NOTE: profiles is an ARRAY)
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        status,
        pickup_confirmed_at,
        return_confirmed_at,
        profiles:profiles(email)
        `
      )
      .eq("id", rentalId)
      .single();

    if (error || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (rental.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Pickup not confirmed yet" },
        { status: 400 }
      );
    }

    if (rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Return already confirmed" },
        { status: 400 }
      );
    }

    // Update rental
    await supabaseAdmin
      .from("rentals")
      .update({
        return_confirmed_at: new Date().toISOString(),
        status: "returned",
      })
      .eq("id", rentalId);

    // Log event
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      type: "return_confirmed",
    });

    // ✅ SAFE email extraction
    const renterEmail = rental.profiles?.[0]?.email;

    if (renterEmail) {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: renterEmail,
        subject: "Vehicle return received",
        html: `
          <p>Your vehicle return has been recorded.</p>
          <p><strong>Status:</strong> Damage review in progress.</p>
          <p>You’ll be notified once the deposit decision is finalized.</p>
        `,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Confirm return error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}