// app/api/auto/upload-verification/route.ts
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

type Kind = "license_front" | "license_back" | "selfie";

const MAX_MB = 8;
const MAX_BYTES = MAX_MB * 1024 * 1024;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isAllowedMime(mime: string) {
  return (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp"
  );
}

function safeExtFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function nowIso() {
  return new Date().toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return jsonError("Server missing Supabase env vars", 500);

    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    const form = await req.formData();

    const rentalId = String(form.get("rentalId") || "").trim();
    const kind = String(form.get("kind") || "").trim() as Kind;
    const file = form.get("file");

    const licenseState = String(form.get("licenseState") || "").trim();
    const licenseExpires = String(form.get("licenseExpires") || "").trim(); // YYYY-MM-DD
    const hasInsurance = String(form.get("hasInsurance") || "").toLowerCase() === "true";

    const capturedLatRaw = form.get("capturedLat");
    const capturedLngRaw = form.get("capturedLng");
    const capturedAccRaw = form.get("capturedAccuracyM");

    const capturedLat =
      capturedLatRaw === null || capturedLatRaw === "" ? null : Number(capturedLatRaw);
    const capturedLng =
      capturedLngRaw === null || capturedLngRaw === "" ? null : Number(capturedLngRaw);
    const capturedAccuracyM =
      capturedAccRaw === null || capturedAccRaw === "" ? null : Number(capturedAccRaw);

    if (!rentalId) return jsonError("Missing rentalId");
    if (kind !== "license_front" && kind !== "license_back" && kind !== "selfie") {
      return jsonError("Invalid kind");
    }
    if (!file || !(file instanceof File)) return jsonError("Missing file");
    if (!isAllowedMime(file.type)) return jsonError("Only JPG/PNG/WEBP images allowed");
    if (file.size > MAX_BYTES) return jsonError(`File too large (max ${MAX_MB}MB)`);

    // Require license meta once (at least when uploading license_front)
    if (kind === "license_front") {
      if (!licenseState || !licenseExpires) {
        return jsonError("Missing licenseState / licenseExpires");
      }
    }

    // Ensure rental belongs to user
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select("id,user_id,status")
      .eq("id", rentalId)
      .eq("user_id", user.id)
      .single();

    if (rentalErr || !rental) return jsonError("Rental not found", 404);

    // Choose bucket based on kind
    const bucket =
      kind === "selfie"
        ? (process.env.RENTER_VERIFICATIONS_BUCKET?.trim() || "renter-verifications")
        : (process.env.RENTER_LICENSES_BUCKET?.trim() || "renter-licenses");

    const ext = safeExtFromMime(file.type);
    const storageKey = `${rentalId}/${kind}/${crypto.randomUUID()}.${ext}`;

    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storageKey, bytes, {
        contentType: file.type,
        upsert: false,
        cacheControl: "3600",
      });

    if (uploadErr) return jsonError(`Upload failed: ${uploadErr.message}`, 500);

    const fileUrl = `supabase://${bucket}/${storageKey}`;

    // Fetch existing row so we can patch just one field at a time
    const { data: existing } = await supabaseAdmin
      .from("renter_verifications")
      .select("*")
      .eq("rental_id", rentalId)
      .maybeSingle();

    const patch: any = {
      rental_id: rentalId,
      user_id: user.id,
      captured_lat: Number.isFinite(capturedLat as any) ? capturedLat : null,
      captured_lng: Number.isFinite(capturedLng as any) ? capturedLng : null,
      captured_accuracy_m: Number.isFinite(capturedAccuracyM as any) ? capturedAccuracyM : null,
      captured_at: nowIso(),
      has_insurance: existing?.has_insurance ?? hasInsurance,
      license_state: existing?.license_state ?? (kind === "license_front" ? licenseState : null),
      license_expires: existing?.license_expires ?? (kind === "license_front" ? licenseExpires : null),
    };

    if (kind === "license_front") patch.license_front_url = fileUrl;
    if (kind === "license_back") patch.license_back_url = fileUrl;
    if (kind === "selfie") patch.selfie_url = fileUrl;

    const { error: upErr } = await supabaseAdmin
      .from("renter_verifications")
      .upsert(patch, { onConflict: "rental_id" });

    if (upErr) {
      // rollback storage if DB fails
      await supabaseAdmin.storage.from(bucket).remove([storageKey]);
      return jsonError(`DB upsert failed: ${upErr.message}`, 500);
    }

    // Check if all required files exist now
    const merged = { ...(existing || {}), ...patch };
    const complete =
      !!merged.license_front_url && !!merged.license_back_url && !!merged.selfie_url;

    if (complete) {
      const { error: updErr } = await supabaseAdmin
        .from("rentals")
        .update({ docs_complete: true, verification_status: "pending" })
        .eq("id", rentalId)
        .eq("user_id", user.id);

      if (updErr) return jsonError(updErr.message, 400);

      await supabaseAdmin.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: user.id,
        actor_role: "renter",
        event_type: "verification_submitted",
        event_payload: {
          has_insurance: merged.has_insurance,
          captured_lat: merged.captured_lat,
          captured_lng: merged.captured_lng,
          captured_accuracy_m: merged.captured_accuracy_m,
        },
      });
    } else {
      await supabaseAdmin.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: user.id,
        actor_role: "renter",
        event_type: "verification_file_uploaded",
        event_payload: { kind },
      });
    }

    return NextResponse.json(
      { ok: true, rentalId, kind, fileUrl, complete },
      { status: 200 }
    );
  } catch (e: any) {
    return jsonError(e?.message || "Server error", 500);
  }
}