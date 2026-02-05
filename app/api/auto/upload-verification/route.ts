// app/api/auto/upload-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);

const MAX_FILE_MB = 10;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function safeExtFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function uploadPrivateImage(opts: {
  bucket: "renter-licenses" | "renter-verifications";
  rentalId: string;
  userId: string;
  kind: string;
  file: File;
}) {
  const { bucket, rentalId, userId, kind, file } = opts;

  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(`Invalid file type: ${file.type}`);
  }
  const bytes = await file.arrayBuffer();
  const sizeMb = bytes.byteLength / (1024 * 1024);
  if (sizeMb > MAX_FILE_MB) {
    throw new Error(`File too large. Max ${MAX_FILE_MB}MB`);
  }

  const ext = safeExtFromMime(file.type);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${userId}/${rentalId}/${kind}-${ts}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, Buffer.from(bytes), {
      contentType: file.type,
      upsert: true,
    });

  if (error) throw new Error(error.message);

  // IMPORTANT: bucket is private; do NOT use getPublicUrl.
  // Store a stable identifier we can sign later:
  return `supabase://${bucket}/${path}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data" },
        { status: 400 }
      );
    }

    const fd = await req.formData();

    const rentalId = String(fd.get("rentalId") || "").trim();
    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    // required files
    const licenseFront = fd.get("licenseFront");
    const licenseBack = fd.get("licenseBack");
    const selfie = fd.get("selfie");

    if (!(licenseFront instanceof File) || !(licenseBack instanceof File) || !(selfie instanceof File)) {
      return NextResponse.json(
        { error: "Missing required files (licenseFront, licenseBack, selfie)" },
        { status: 400 }
      );
    }

    // optional fields
    const licenseState = String(fd.get("licenseState") || "").trim();
    const licenseExpires = String(fd.get("licenseExpires") || "").trim(); // YYYY-MM-DD
    const hasInsuranceRaw = String(fd.get("hasInsurance") || "").trim();
    const hasInsurance =
      hasInsuranceRaw === "true" || hasInsuranceRaw === "1" || hasInsuranceRaw === "yes";

    const capturedLat = fd.get("capturedLat");
    const capturedLng = fd.get("capturedLng");
    const capturedAccuracyM = fd.get("capturedAccuracyM");

    const lat = capturedLat ? Number(capturedLat) : null;
    const lng = capturedLng ? Number(capturedLng) : null;
    const acc = capturedAccuracyM ? Number(capturedAccuracyM) : null;

    // Ensure rental belongs to user
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select("id,user_id,status")
      .eq("id", rentalId)
      .eq("user_id", user.id)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Upload files to private buckets
    const licenseFrontRef = await uploadPrivateImage({
      bucket: "renter-licenses",
      rentalId,
      userId: user.id,
      kind: "license_front",
      file: licenseFront,
    });

    const licenseBackRef = await uploadPrivateImage({
      bucket: "renter-licenses",
      rentalId,
      userId: user.id,
      kind: "license_back",
      file: licenseBack,
    });

    const selfieRef = await uploadPrivateImage({
      bucket: "renter-verifications",
      rentalId,
      userId: user.id,
      kind: "selfie",
      file: selfie,
    });

    // Upsert verification row (one per rental)
    const { error: upErr } = await supabaseAdmin
      .from("renter_verifications")
      .upsert(
        {
          rental_id: rentalId,
          user_id: user.id,
          license_front_url: licenseFrontRef,
          license_back_url: licenseBackRef,
          selfie_url: selfieRef,
          license_state: licenseState || null,
          license_expires: licenseExpires || null,
          has_insurance: hasInsurance,
          captured_lat: Number.isFinite(lat as any) ? lat : null,
          captured_lng: Number.isFinite(lng as any) ? lng : null,
          captured_accuracy_m: Number.isFinite(acc as any) ? acc : null,
          captured_at: new Date().toISOString(),
        },
        { onConflict: "rental_id" }
      );

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    // Mark docs complete + set pending status (server-only)
    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({ docs_complete: true, verification_status: "pending" })
      .eq("id", rentalId)
      .eq("user_id", user.id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    // Audit event
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "verification_submitted",
      event_payload: {
        has_insurance: hasInsurance,
        captured_lat: Number.isFinite(lat as any) ? lat : null,
        captured_lng: Number.isFinite(lng as any) ? lng : null,
        captured_accuracy_m: Number.isFinite(acc as any) ? acc : null,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        uploaded: {
          license_front: licenseFrontRef,
          license_back: licenseBackRef,
          selfie: selfieRef,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}