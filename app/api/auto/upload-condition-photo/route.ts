export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TEST_MODE =
  process.env.NEXT_PUBLIC_TEST_MODE === "1" ||
  process.env.NEXT_PUBLIC_TEST_MODE === "true";

const BUCKET =
  process.env.SUPABASE_CONDITION_PHOTOS_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_CONDITION_PHOTOS_BUCKET ||
  "rental-photos"; // <-- if your bucket name differs, set SUPABASE_CONDITION_PHOTOS_BUCKET

const MAX_BYTES = 7 * 1024 * 1024; // 7MB cap
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type Phase =
  | "pickup_exterior"
  | "pickup_interior"
  | "return_exterior"
  | "return_interior";

function nowIso() {
  return new Date().toISOString();
}

function asNumberOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function phaseToStatusAfterUpload(phase: Phase) {
  if (phase === "pickup_exterior") return "pickup_exterior_done";
  if (phase === "pickup_interior") return "pickup_interior_done";
  if (phase === "return_exterior") return "return_exterior_done";
  if (phase === "return_interior") return "return_interior_done";
  return "not_started";
}

function canUploadPhase(params: {
  phase: Phase;
  lockboxReleased: boolean;
  pickupConfirmed: boolean;
  currentStatus: string | null;
}) {
  const { phase, lockboxReleased, pickupConfirmed } = params;

  // Pickup phases require lockbox released
  if ((phase === "pickup_exterior" || phase === "pickup_interior") && !lockboxReleased) {
    return { ok: false, error: "Pickup photos require lockbox code release first." };
  }

  // Return phases require pickup confirmed
  if ((phase === "return_exterior" || phase === "return_interior") && !pickupConfirmed) {
    return { ok: false, error: "Return photos require pickup to be confirmed first." };
  }

  // Optional stricter ordering: require return_exterior before return_interior
  if (phase === "return_interior" && params.currentStatus !== "return_exterior_done" && params.currentStatus !== "return_interior_done") {
    return { ok: false, error: "Upload return exterior photos before return interior photos." };
  }

  return { ok: true };
}

export async function POST(req: NextRequest) {
  try {
    // -------- AUTH --------
    const user = await getUserFromRequest(req);

    // -------- FORM DATA --------
    const form = await req.formData();

    const rentalId = String(form.get("rentalId") || "").trim();
    const phase = String(form.get("phase") || "").trim() as Phase;
    const file = form.get("file") as File | null;

    // GPS fields (optional in TEST MODE)
    const lat = asNumberOrNull(form.get("lat"));
    const lng = asNumberOrNull(form.get("lng"));
    const accuracy_m = asNumberOrNull(form.get("accuracy_m"));

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const allowedPhases: Phase[] = [
      "pickup_exterior",
      "pickup_interior",
      "return_exterior",
      "return_interior",
    ];
    if (!allowedPhases.includes(phase)) {
      return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    // -------- FILE VALIDATION --------
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: "Only image uploads are allowed." }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${(MAX_BYTES / (1024 * 1024)).toFixed(0)}MB.` },
        { status: 400 }
      );
    }

    // -------- LOAD RENTAL (OWNER CHECK) --------
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        renter_id,
        lockbox_code_released_at,
        pickup_confirmed_at,
        condition_photos_status
      `
      )
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    const ownerId = rental.user_id || rental.renter_id;
    if (ownerId !== user.id) {
      return NextResponse.json({ error: "Not authorized for this rental" }, { status: 403 });
    }

    // -------- PHASE ENFORCEMENT --------
    const gate = canUploadPhase({
      phase,
      lockboxReleased: !!rental.lockbox_code_released_at,
      pickupConfirmed: !!rental.pickup_confirmed_at,
      currentStatus: rental.condition_photos_status || null,
    });

    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: 400 });
    }

    // -------- GPS RULES --------
    // In test mode: GPS can be missing.
    // In normal mode: strongly recommend GPS, but we won't hard-fail.
    // (If you want hard enforcement later, we can do that, but it hurts real users.)
    const gpsProvided = lat !== null && lng !== null;

    if (!TEST_MODE) {
      // no hard failure — just log missing GPS as nulls
      // (Admin UI can show warnings)
    }

    // -------- UPLOAD TO STORAGE --------
    const bytes = new Uint8Array(await file.arrayBuffer());

    // Path structure keeps it tidy and queryable by rentalId + phase
    const safeExt = file.type.includes("png")
      ? "png"
      : file.type.includes("webp")
      ? "webp"
      : file.type.includes("heic") || file.type.includes("heif")
      ? "heic"
      : "jpg";

    const fileName = `${phase}-${Date.now()}.${safeExt}`;
    const storagePath = `rentals/${rentalId}/${phase}/${fileName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: file.type,
        upsert: false,
      });

    if (upErr) {
      return NextResponse.json(
        { error: `Upload failed: ${upErr.message}` },
        { status: 500 }
      );
    }

    // Create a signed URL (short-lived) for immediate UI preview if needed
    const { data: signed } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60 * 20); // 20 minutes

    // -------- DB WRITE: photo record + rental status update --------
    // IMPORTANT: this assumes you have a table for condition photos.
    // If your existing code writes to a different table, tell me the table name and I'll align it.
    await supabaseAdmin.from("rental_condition_photos").insert({
      rental_id: rentalId,
      phase,
      storage_path: storagePath,
      captured_at: nowIso(),
      captured_lat: gpsProvided ? lat : null,
      captured_lng: gpsProvided ? lng : null,
      captured_accuracy_m: gpsProvided ? accuracy_m : null,
      test_mode: TEST_MODE,
    });

    const nextStatus = phaseToStatusAfterUpload(phase);

    await supabaseAdmin
      .from("rentals")
      .update({
        condition_photos_status: nextStatus,
        condition_photos_complete: nextStatus === "return_interior_done" || nextStatus === "complete",
      })
      .eq("id", rentalId);

    // Audit log (optional but recommended)
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      event_type: "condition_photo_uploaded",
      detail: {
        phase,
        storagePath,
        gpsProvided,
        testMode: TEST_MODE,
      },
      created_at: nowIso(),
    });

    return NextResponse.json({
      ok: true,
      rentalId,
      phase,
      storagePath,
      signedUrl: signed?.signedUrl || null,
      testMode: TEST_MODE,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Upload error" },
      { status: 500 }
    );
  }
}