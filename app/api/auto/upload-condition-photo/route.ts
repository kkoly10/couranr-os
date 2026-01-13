import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    // --------------------------------------------------
    // Auth
    // --------------------------------------------------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --------------------------------------------------
    // Body
    // --------------------------------------------------
    const body = await req.json().catch(() => ({}));

    const {
      rentalId,
      phase, // pickup_exterior | pickup_interior | return_exterior | return_interior
      photoUrl,
      capturedLat,
      capturedLng,
      capturedAccuracyM,
    } = body;

    if (!rentalId || !phase || !photoUrl) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const allowedPhases = [
      "pickup_exterior",
      "pickup_interior",
      "return_exterior",
      "return_interior",
    ];

    if (!allowedPhases.includes(phase)) {
      return NextResponse.json(
        { error: "Invalid photo phase" },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // Ownership check (RLS backs this up)
    // --------------------------------------------------
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select(
        `
        id,
        user_id,
        verification_status,
        agreement_signed,
        paid,
        pickup_confirmed_at
      `
      )
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (rental.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // --------------------------------------------------
    // Phase gating (CRITICAL SECURITY)
    // --------------------------------------------------
    if (
      (phase === "pickup_exterior" || phase === "pickup_interior") &&
      (!rental.paid ||
        !rental.agreement_signed ||
        rental.verification_status !== "approved")
    ) {
      return NextResponse.json(
        { error: "Pickup photos not allowed yet" },
        { status: 403 }
      );
    }

    if (
      (phase === "return_exterior" || phase === "return_interior") &&
      !rental.pickup_confirmed_at
    ) {
      return NextResponse.json(
        { error: "Return photos not allowed yet" },
        { status: 403 }
      );
    }

    // --------------------------------------------------
    // Insert photo
    // --------------------------------------------------
    const { error: insertErr } = await supabase
      .from("rental_condition_photos")
      .insert({
        rental_id: rentalId,
        user_id: user.id,
        phase,
        photo_url: photoUrl,
        captured_lat: capturedLat ?? null,
        captured_lng: capturedLng ?? null,
        captured_accuracy_m: capturedAccuracyM ?? null,
      });

    if (insertErr) {
      return NextResponse.json(
        { error: insertErr.message },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // Advance condition_photos_status
    // --------------------------------------------------
    const statusMap: Record<string, string> = {
      pickup_exterior: "pickup_exterior_done",
      pickup_interior: "pickup_interior_done",
      return_exterior: "return_exterior_done",
      return_interior: "return_interior_done",
    };

    const nextStatus = statusMap[phase];

    if (nextStatus) {
      await supabase
        .from("rentals")
        .update({ condition_photos_status: nextStatus })
        .eq("id", rentalId);
    }

    // --------------------------------------------------
    // Audit log
    // --------------------------------------------------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "condition_photo_uploaded",
      event_payload: {
        phase,
        photo_url: photoUrl,
        lat: capturedLat ?? null,
        lng: capturedLng ?? null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("upload-condition-photo error:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}