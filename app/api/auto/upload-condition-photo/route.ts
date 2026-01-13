import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---------------- CONFIG ----------------

const MAX_PHOTOS_PER_PHASE = 12;
const MAX_FILE_SIZE_MB = 8;
const ALLOWED_MIME_PREFIX = "image/";

// ----------------------------------------

export async function POST(req: NextRequest) {
  try {
    // ---------------- AUTH ----------------
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

    // ---------------- PARSE FORM ----------------
    const form = await req.formData();

    const rentalId = form.get("rentalId")?.toString();
    const phase = form.get("phase")?.toString();
    const file = form.get("file") as File | null;

    const lat = form.get("lat") ? Number(form.get("lat")) : null;
    const lng = form.get("lng") ? Number(form.get("lng")) : null;
    const accuracy = form.get("accuracy") ? Number(form.get("accuracy")) : null;

    if (!rentalId || !phase || !file) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const ALLOWED_PHASES = [
      "pickup_exterior",
      "pickup_interior",
      "return_exterior",
      "return_interior",
    ];

    if (!ALLOWED_PHASES.includes(phase)) {
      return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
    }

    // ---------------- FILE VALIDATION ----------------
    if (!file.type.startsWith(ALLOWED_MIME_PREFIX)) {
      return NextResponse.json(
        { error: "Only image uploads allowed" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large" },
        { status: 400 }
      );
    }

    // ---------------- FETCH RENTAL ----------------
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select(`
        id,
        user_id,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at
      `)
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (rental.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------------- PHASE GATES ----------------
    if (
      phase === "pickup_interior" &&
      !rental.lockbox_code_released_at
    ) {
      return NextResponse.json(
        { error: "Lockbox not released yet" },
        { status: 400 }
      );
    }

    if (
      (phase === "return_exterior" || phase === "return_interior") &&
      !rental.pickup_confirmed_at
    ) {
      return NextResponse.json(
        { error: "Pickup not confirmed yet" },
        { status: 400 }
      );
    }

    if (phase === "return_interior") {
      const { count } = await supabase
        .from("rental_condition_photos")
        .select("*", { count: "exact", head: true })
        .eq("rental_id", rentalId)
        .eq("phase", "return_exterior");

      if (!count || count === 0) {
        return NextResponse.json(
          { error: "Return exterior photos required first" },
          { status: 400 }
        );
      }
    }

    // ---------------- PHOTO COUNT LIMIT ----------------
    const { count: existingCount } = await supabase
      .from("rental_condition_photos")
      .select("*", { count: "exact", head: true })
      .eq("rental_id", rentalId)
      .eq("phase", phase);

    if ((existingCount || 0) >= MAX_PHOTOS_PER_PHASE) {
      return NextResponse.json(
        { error: "Photo limit reached for this phase" },
        { status: 400 }
      );
    }

    // ---------------- STORAGE UPLOAD ----------------
    const fileExt = file.name.split(".").pop();
    const storagePath = `rentals/${rentalId}/${phase}/${crypto.randomUUID()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("renter-verifications")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: "Upload failed" },
        { status: 500 }
      );
    }

    const { data: publicUrl } = supabase.storage
      .from("renter-verifications")
      .getPublicUrl(storagePath);

    // ---------------- INSERT PHOTO RECORD ----------------
    const { error: insertError } = await supabase
      .from("rental_condition_photos")
      .insert({
        rental_id: rentalId,
        user_id: user.id,
        phase,
        photo_url: publicUrl.publicUrl,
        captured_lat: lat,
        captured_lng: lng,
        captured_accuracy_m: accuracy,
      });

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to save photo record" },
        { status: 500 }
      );
    }

    // ---------------- AUDIT LOG ----------------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "photo_uploaded",
      event_payload: {
        phase,
        gps_provided: lat !== null && lng !== null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("UPLOAD PHOTO ERROR:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}