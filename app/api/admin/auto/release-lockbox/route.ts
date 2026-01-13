import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// ---------- INIT ----------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

// ---------- HELPERS ----------
function generateLockboxCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ---------- HANDLER ----------
export async function POST(req: NextRequest) {
  try {
    // ---------- AUTH ----------
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ---------- ROLE CHECK ----------
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------- INPUT ----------
    const body = await req.json();
    const rentalId = body?.rentalId;

    if (!rentalId) {
      return NextResponse.json(
        { error: "Missing rentalId" },
        { status: 400 }
      );
    }

    // ---------- FETCH RENTAL ----------
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select(`
        id,
        user_id,
        verification_status,
        docs_complete,
        agreement_signed,
        paid,
        lockbox_code_released_at,
        vehicles ( year, make, model ),
        profiles ( email )
      `)
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // ---------- HARD GATES ----------
    if (rental.lockbox_code_released_at) {
      return NextResponse.json(
        { error: "Lockbox already released" },
        { status: 400 }
      );
    }

    if (rental.verification_status !== "approved") {
      return NextResponse.json(
        { error: "Renter not approved" },
        { status: 400 }
      );
    }

    if (!rental.docs_complete) {
      return NextResponse.json(
        { error: "Documents not complete" },
        { status: 400 }
      );
    }

    if (!rental.agreement_signed) {
      return NextResponse.json(
        { error: "Agreement not signed" },
        { status: 400 }
      );
    }

    if (!rental.paid) {
      return NextResponse.json(
        { error: "Payment not completed" },
        { status: 400 }
      );
    }

    // ---------- RELEASE LOCKBOX ----------
    const lockboxCode = generateLockboxCode();
    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("rentals")
      .update({
        lockbox_code: lockboxCode,
        lockbox_code_released_at: now,
      })
      .eq("id", rentalId);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to release lockbox" },
        { status: 500 }
      );
    }

    // ---------- AUDIT ----------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "admin",
      event_type: "lockbox_released",
      event_payload: {
        lockbox_code: lockboxCode,
      },
    });

    // ---------- EMAIL ----------
    const renterEmail =
      Array.isArray(rental.profiles) && rental.profiles.length > 0
        ? rental.profiles[0].email
        : null;

    if (renterEmail) {
      const car =
        rental.vehicles
          ? `${rental.vehicles.year} ${rental.vehicles.make} ${rental.vehicles.model}`
          : "Your rental vehicle";

      await resend.emails.send({
        from: "Couranr Auto <no-reply@couranr.com>",
        to: renterEmail,
        subject: "🔓 Your vehicle is ready for pickup",
        html: `
          <h2>Your rental is approved</h2>
          <p><strong>Vehicle:</strong> ${car}</p>

          <p><strong>Lockbox code:</strong></p>
          <h1 style="letter-spacing:2px;">${lockboxCode}</h1>

          <p>
            Please take <strong>exterior photos</strong> before driving.
          </p>

          <hr />
          <small>Couranr Auto</small>
        `,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("LOCKBOX RELEASE ERROR:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}