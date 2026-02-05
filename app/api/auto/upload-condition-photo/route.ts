// app/api/auto/upload-condition-photo/route.ts
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Set these in Vercel if you want:
// AUTO_TEST_MODE=true
// RENTAL_PHOTOS_BUCKET=rental-photos
const TEST_MODE = (process.env.AUTO_TEST_MODE || "").toLowerCase() === "true";
const BUCKET = process.env.RENTAL_PHOTOS_BUCKET || "rental-photos";

// Hard limits (safe defaults)
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_PHOTOS_PER_PHASE = 12;
// simple burst limiter: max uploads per rental per minute
const MAX_UPLOADS_PER_MINUTE = 20;

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function isImageMime(mime: string | null) {
  if (!mime) return false;
  return (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    mime === "image/heic" ||
    mime === "image/heif"
  );
}

/**
 * Phase rules:
 * - pickup_* requires lockbox released
 * - return_* requires pickup_confirmed_at
 */
function enforcePhaseRules(rental: any, phase: string) {
  const p = (phase || "").toLowerCase();

  if (p.startsWith("pickup")) {
    if (!rental.lockbox_code_released_at) {
      throw new Error("Pickup photos are locked until lockbox is released.");
    }
    if (rental.return_confirmed_at) {
      throw new Error("Rental already returned. Pickup photos are closed.");
    }
  }

  if (p.startsWith("return")) {
    if (!rental.pickup_confirmed_at) {
      throw new Error("Return photos are locked until pickup is confirmed.");
    }
    if (rental.return_confirmed_at) {
      throw new Error("Return already confirmed. Photos are closed.");
    }
  }

  // Optional ordering rule (industry style):
  // require return_exterior before return_interior
  if (p === "return_interior") {
    // only enforce if you want strict ordering
    // (leave disabled if you want flexibility)
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return jsonError(500, "Server misconfigured (missing Supabase env vars).");
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // --- Auth user from Bearer token ---
    const user = await getUserFromRequest(req);

    // --- Parse multipart form ---
    const form = await req.formData();
    const rentalId = String(form.get("rentalId") || "").trim();
    const phase = String(form.get("phase") || "").trim();

    if (!rentalId) return jsonError(400, "Missing rentalId.");
    if (!phase) return jsonError(400, "Missing phase.");

    const file = form.get("file") as File | null;
    if (!file) return jsonError(400, "Missing file.");

    if (!isImageMime(file.type)) {
      return jsonError(400, `Invalid file type (${file.type}). Use JPG/PNG/WEBP/HEIC.`);
    }

    if (file.size > MAX_FILE_BYTES) {
      return jsonError(400, `File too large. Max ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB.`);
    }

    // --- GPS fields (optional) ---
    // We accept these if present. If TEST_MODE, we allow nulls freely.
    const capturedLatRaw = form.get("capturedLat");
    const capturedLngRaw = form.get("capturedLng");
    const capturedAccRaw = form.get("capturedAccuracyM");

    const captured_lat =
      capturedLatRaw === null || capturedLatRaw === ""
        ? null
        : Number(capturedLatRaw);
    const captured_lng =
      capturedLngRaw === null || capturedLngRaw === ""
        ? null
        : Number(capturedLngRaw);
    const captured_accuracy_m =
      capturedAccRaw === null || capturedAccRaw === ""
        ? null
        : Number(capturedAccRaw);

    const hasGps =
      Number.isFinite(captured_lat as any) && Number.isFinite(captured_lng as any);

    if (!TEST_MODE) {
      // GPS is NOT required, but if provided it must be valid
      if (captured_lat !== null && !Number.isFinite(captured_lat)) {
        return jsonError(400, "Invalid capturedLat.");
      }
      if (captured_lng !== null && !Number.isFinite(captured_lng)) {
        return jsonError(400, "Invalid capturedLng.");
      }
      if (captured_accuracy_m !== null && !Number.isFinite(captured_accuracy_m)) {
        return jsonError(400, "Invalid capturedAccuracyM.");
      }
    }

    // --- Load rental (ownership + gating prerequisites) ---
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select(
        "id, user_id, renter_id, lockbox_code_released_at, pickup_confirmed_at, return_confirmed_at, paid, agreement_signed, docs_complete, approval_status, verification_status, condition_photos_status"
      )
      .eq("id", rentalId)
      .maybeSingle();

    if (rentalErr) return jsonError(500, rentalErr.message);
    if (!rental) return jsonError(404, "Rental not found.");

    // Ownership: support either user_id or renter_id being the renter
    const ownerOk = rental.user_id === user.id || rental.renter_id === user.id;
    if (!ownerOk) return jsonError(403, "Not authorized for this rental.");

    // Phase bypass protection
    enforcePhaseRules(rental, phase);

    // --- Rate limit: per rental per minute ---
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount, error: rateErr } = await supabase
      .from("rental_condition_photos")
      .select("id", { count: "exact", head: true })
      .eq("rental_id", rentalId)
      .gte("created_at", oneMinuteAgo);

    if (rateErr) return jsonError(500, rateErr.message);
    if ((recentCount || 0) >= MAX_UPLOADS_PER_MINUTE) {
      return jsonError(429, "Too many uploads. Please wait a minute and try again.");
    }

    // --- Cap photos per phase ---
    const { count: phaseCount, error: phaseErr } = await supabase
      .from("rental_condition_photos")
      .select("id", { count: "exact", head: true })
      .eq("rental_id", rentalId)
      .eq("phase", phase);

    if (phaseErr) return jsonError(500, phaseErr.message);
    if ((phaseCount || 0) >= MAX_PHOTOS_PER_PHASE) {
      return jsonError(400, `Max photos reached for this phase (${MAX_PHOTOS_PER_PHASE}).`);
    }

    // --- Upload to storage ---
    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
        ? "webp"
        : file.type === "image/heic" || file.type === "image/heif"
        ? "heic"
        : "jpg";

    const safePhase = phase.replace(/[^a-zA-Z0-9_-]/g, "_");
    const objectPath = `rentals/${rentalId}/${safePhase}/${crypto.randomUUID()}.${ext}`;

    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, bytes, {
        contentType: file.type,
        upsert: false,
      });

    if (upErr) {
      return jsonError(
        500,
        `Storage upload failed. Check bucket "${BUCKET}" exists. (${upErr.message})`
      );
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
    const photo_url = pub?.publicUrl;

    if (!photo_url) return jsonError(500, "Could not create public URL.");

    const nowIso = new Date().toISOString();

    // --- Insert DB row ---
    const insertRow = {
      rental_id: rentalId,
      user_id: user.id,
      phase,
      photo_url,
      captured_lat: hasGps ? captured_lat : null,
      captured_lng: hasGps ? captured_lng : null,
      captured_accuracy_m: hasGps ? captured_accuracy_m : null,
      // Use server time for reliability (less spoofable)
      captured_at: nowIso,
      created_at: nowIso,
    };

    const { data: created, error: insErr } = await supabase
      .from("rental_condition_photos")
      .insert(insertRow)
      .select("id, photo_url, phase, created_at")
      .single();

    if (insErr) return jsonError(500, insErr.message);

    // --- Optional: update condition_photos_status ---
    // We do NOT mark condition_photos_complete here unless your rules confirm all phases.
    // But we can set a "started" signal.
    if (!rental.condition_photos_status || rental.condition_photos_status === "not_started") {
      await supabase
        .from("rentals")
        .update({ condition_photos_status: "in_progress" })
        .eq("id", rentalId);
    }

    return NextResponse.json(
      {
        ok: true,
        testMode: TEST_MODE,
        photo: created,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return jsonError(400, e?.message || "Upload failed.");
  }
}