import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/notify";

/**
 * POST /api/auto/notify
 *
 * Body:
 * {
 *   rentalId: string,
 *   type:
 *     | "verification_submitted"
 *     | "approved"
 *     | "pickup_ready"
 *     | "return_reminder"
 *     | "deposit_refunded"
 *     | "deposit_withheld"
 * }
 */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { rentalId, type } = body;

    if (!rentalId || !type) {
      return NextResponse.json(
        { error: "Missing rentalId or type" },
        { status: 400 }
      );
    }

    // Admin/service-role Supabase (server only)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch rental + renter email
    const { data: rental, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        user_id,
        vehicles ( year, make, model ),
        profiles:profiles!rentals_user_id_fkey ( email )
      `
      )
      .eq("id", rentalId)
      .single();

    if (error || !rental) {
      return NextResponse.json(
        { error: "Rental not found" },
        { status: 404 }
      );
    }

    const email = rental.profiles?.email;
    if (!email) {
      return NextResponse.json(
        { error: "Renter email not found" },
        { status: 400 }
      );
    }

    const v: any = rental.vehicles;
    const vehicleLabel =
      `${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim() ||
      "Couranr Auto Rental";

    // -----------------------------
    // Email templates (simple + safe)
    // -----------------------------

    let subject = "Couranr Auto Update";
    let html = `<p>There is an update regarding your rental.</p>`;

    switch (type) {
      case "verification_submitted":
        subject = "ID Verification Received";
        html = `
          <p>We’ve received your ID verification for:</p>
          <p><strong>${vehicleLabel}</strong></p>
          <p>Our team is reviewing it now.</p>
        `;
        break;

      case "approved":
        subject = "Rental Approved";
        html = `
          <p>Your rental has been <strong>approved</strong>:</p>
          <p><strong>${vehicleLabel}</strong></p>
          <p>You’ll receive pickup instructions shortly.</p>
        `;
        break;

      case "pickup_ready":
        subject = "Pickup Ready";
        html = `
          <p>Your rental is ready for pickup:</p>
          <p><strong>${vehicleLabel}</strong></p>
          <p>Please log into your dashboard to view the lockbox code and complete pickup photos.</p>
        `;
        break;

      case "return_reminder":
        subject = "Return Reminder";
        html = `
          <p>This is a reminder to return your rental:</p>
          <p><strong>${vehicleLabel}</strong></p>
          <p>Please complete return photos in your dashboard.</p>
        `;
        break;

      case "deposit_refunded":
        subject = "Deposit Refunded";
        html = `
          <p>Your security deposit has been <strong>refunded</strong>.</p>
          <p>Thank you for renting with Couranr.</p>
        `;
        break;

      case "deposit_withheld":
        subject = "Deposit Update";
        html = `
          <p>Your deposit was <strong>partially or fully withheld</strong>.</p>
          <p>Please check your dashboard for details.</p>
        `;
        break;

      default:
        return NextResponse.json(
          { error: "Unsupported notification type" },
          { status: 400 }
        );
    }

    await sendEmail({
      to: email,
      subject,
      html,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Auto notify error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}