export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";
import { Resend } from "resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    // -------------------------------
    // Auth
    // -------------------------------
    const user = await getUserFromRequest(req);
    const { rentalId } = await req.json();

    if (!rentalId) {
      return NextResponse.json(
        { error: "Missing rentalId" },
        { status: 400 }
      );
    }

    // -------------------------------
    // Fetch rental + renter email
    // -------------------------------
    const { data: rental, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        user_id,
        lockbox_code_released_at,
        pickup_confirmed_at,
        pickup_interior_completed,
        pickup_exterior_completed,
        profiles:profiles(email)
      `
      )
      .eq("id", rentalId)
      .eq("user_id", user.id)
      .single();

    if (error || !rental) {
      return NextResponse.json(
        { error: "Rental not found" },
        { status: 404 }
      );
    }

    // -------------------------------
    // Enforcement checks
    // -------------------------------
    if (!rental.lockbox_code_released_at) {
      return NextResponse.json(
        { error: "Lockbox not released yet" },
        { status: 403 }
      );
    }

    if (
      !rental.pickup_interior_completed ||
      !rental.pickup_exterior_completed
    ) {
      return NextResponse.json(
        { error: "Pickup photos incomplete" },
        { status: 403 }
      );
    }

    if (rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Pickup already confirmed" },
        { status: 400 }
      );
    }

    // -------------------------------
    // Confirm pickup
    // -------------------------------
    await supabase
      .from("rentals")
      .update({
        pickup_confirmed_at: new Date().toISOString(),
        status: "active",
      })
      .eq("id", rentalId);

    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      type: "pickup_confirmed",
      actor: "renter",
    });

    // -------------------------------
    // Email renter (SAFE ARRAY ACCESS)
    // -------------------------------
    const renterEmail = rental.profiles?.[0]?.email;

    if (renterEmail) {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: renterEmail,
        subject: "Pickup confirmed — enjoy your rental",
        html: `
          <p>Your pickup has been successfully confirmed.</p>
          <p>Please drive safely and report any issues immediately.</p>
          <p>— Couranr Auto</p>
        `,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Confirm pickup error:", err);
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}