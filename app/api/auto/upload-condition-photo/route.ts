// app/api/auto/upload-condition-photo/route.ts
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

type Phase = "pickup_exterior" | "pickup_interior" | "return_exterior" | "return_interior";

const MAX_MB = 8;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const MAX_PHOTOS_PER_PHASE = 12;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function nowIso() { return new Date().toISOString(); }

function isAllowedMime(mime: string) {
  return mime === "image/jpeg" || mime === "image/jpg" || mime === "image/png" || mime === "image/webp";
}

function safeExtFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function isValidPhase(phase: string): phase is Phase {
  return phase === "pickup_exterior" || phase === "pickup_interior" || phase === "return_exterior" || phase === "return_interior";
}

// Helper to prevent downgrading statuses
const PHASE_WEIGHTS: Record<string, number> = {
  not_started: 0,
  pickup_exterior_done: 1,
  pickup_interior_done: 2,
  return_exterior_done: 3,
  return_interior_done: 4,
  complete: 5,
};

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return jsonError("Server missing Supabase env vars", 500);

    const bucket = (process.env.RENTAL_PHOTOS_BUCKET || "rental-photos").trim();

    const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const form = await req.formData();
    const rentalId = String(form.get("rentalId") || "").trim();
    const phaseRaw = String(form.get("phase") || "").trim();
    const phase = phaseRaw as Phase;

    const capturedLatRaw = form.get("capturedLat");
    const capturedLngRaw = form.get("capturedLng");
    const capturedAccRaw = form.get("capturedAccuracyM");

    const capturedLat = capturedLatRaw === null || capturedLatRaw === "" ? null : Number(capturedLatRaw);
    const capturedLng = capturedLngRaw === null || capturedLngRaw === "" ? null : Number(capturedLngRaw);
    const capturedAccuracyM = capturedAccRaw === null || capturedAccRaw === "" ? null : Number(capturedAccRaw);

    const file = form.get("file");

    if (!rentalId) return jsonError("Missing rentalId");
    if (!phaseRaw) return jsonError("Missing phase");
    if (!isValidPhase(phaseRaw)) return jsonError("Invalid phase");
    if (!file || !(file instanceof File)) return jsonError("Missing file");
    if (!isAllowedMime(file.type)) return jsonError("Only JPG/PNG/WEBP images allowed");
    if (file.size > MAX_BYTES) return jsonError(`File too large (max ${MAX_MB}MB)`);

    // Load rental + enforce ownership + phase gating
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(`id, user_id, renter_id, lockbox_code_released_at, pickup_confirmed_at, return_confirmed_at, condition_photos_status`)
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) return jsonError("Rental not found", 404);

    const ownerOk = rental.user_id === user.id || rental.renter_id === user.id;
    if (!ownerOk) return jsonError("Forbidden", 403);

    // Keep evidence clean
    if (rental.return_confirmed_at) return jsonError("Return already confirmed. Uploads are closed.", 409);

    // Phase bypass prevention
    if ((phase === "pickup_exterior" || phase === "pickup_interior") && !rental.lockbox_code_released_at) {
      return jsonError("Pickup photos require lockbox release first.", 409);
    }
    if ((phase === "return_exterior" || phase === "return_interior") && !rental.pickup_confirmed_at) {
      return jsonError("Return photos require pickup confirmation first.", 409);
    }

    if (phase === "return_interior") {
      const { count: extCount } = await supabaseAdmin
        .from("rental_condition_photos")
        .select("*", { count: "exact", head: true })
        .eq("rental_id", rentalId)
        .eq("phase", "return_exterior");

      if (!extCount || extCount < 1) {
        return jsonError("Return interior requires at least one return exterior photo first.", 409);
      }
    }

    // Cap photos per phase
    const { count } = await supabaseAdmin
      .from("rental_condition_photos")
      .select("*", { count: "exact", head: true })
      .eq("rental_id", rentalId)
      .eq("phase", phase);

    if ((count || 0) >= MAX_PHOTOS_PER_PHASE) return jsonError(`Photo limit reached for ${phase} (max ${MAX_PHOTOS_PER_PHASE}).`, 409);

    const ext = safeExtFromMime(file.type);
    const key = `${rentalId}/${phase}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadErr } = await supabaseAdmin.storage.from(bucket).upload(key, bytes, {
      contentType: file.type,
      upsert: false,
      cacheControl: "3600",
    });

    if (uploadErr) return jsonError(`Upload failed: ${uploadErr.message}`, 500);

    const photoUrl = `supabase://${bucket}/${key}`;

    const { error: insertErr } = await supabaseAdmin.from("rental_condition_photos").insert({
      rental_id: rentalId, user_id: user.id, phase, photo_url: photoUrl,
      captured_lat: Number.isFinite(capturedLat as any) ? capturedLat : null,
      captured_lng: Number.isFinite(capturedLng as any) ? capturedLng : null,
      captured_accuracy_m: Number.isFinite(capturedAccuracyM as any) ? capturedAccuracyM : null,
      captured_at: nowIso(), created_at: nowIso(),
    });

    if (insertErr) {
      await supabaseAdmin.storage.from(bucket).remove([key]);
      return jsonError(`DB insert failed: ${insertErr.message}`, 500);
    }

    // THE FIX: Smart Status Upgrading (Prevents Downgrading if they upload out of order)
    let triggeredStatus = "";
    if (phase === "pickup_exterior") triggeredStatus = "pickup_exterior_done";
    if (phase === "pickup_interior") triggeredStatus = "pickup_interior_done";
    if (phase === "return_exterior") triggeredStatus = "return_exterior_done";
    if (phase === "return_interior") triggeredStatus = "complete";

    const currentStatus = rental.condition_photos_status || "not_started";
    
    // Only update the database if the new status is further along than the old status
    if (PHASE_WEIGHTS[triggeredStatus] > PHASE_WEIGHTS[currentStatus]) {
      await supabaseAdmin
        .from("rentals")
        .update({ condition_photos_status: triggeredStatus })
        .eq("id", rentalId);
    }

    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId, actor_user_id: user.id, actor_role: "renter",
      event_type: "condition_photo_uploaded", event_payload: { phase, photo_url: photoUrl },
    });

    return NextResponse.json({ ok: true, rentalId, phase, photo_url: photoUrl }, { status: 200 });
  } catch (e: any) {
    return jsonError(e?.message || "Server error", 500);
  }
}
