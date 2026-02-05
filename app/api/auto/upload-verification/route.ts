// app/api/auto/upload-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Buckets (from your Supabase list)
const BUCKET_LICENSES = "renter-licenses"; // private
const BUCKET_VERIFICATIONS = "renter-verifications"; // private

type Kind = "license_front" | "license_back" | "selfie";

function asString(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function asBool(v: any) {
  if (typeof v === "boolean") return v;
  const s = asString(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

function asNumberOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function pickBucket(kind: Kind) {
  // Licenses go in renter-licenses, selfie in renter-verifications
  if (kind === "selfie") return BUCKET_VERIFICATIONS;
  return BUCKET_LICENSES;
}

function setFieldForKind(kind: Kind, ref: string) {
  if (kind === "license_front") return { license_front_url: ref };
  if (kind === "license_back") return { license_back_url: ref };
  return { selfie_url: ref };
}

async function finalizeDocsIfComplete(rentalId: string, userId: string) {
  // check verification row
  const { data: ver } = await supabaseAdmin
    .from("renter_verifications")
    .select(
      "license_front_url,license_back_url,selfie_url,license_state,license_expires"
    )
    .eq("rental_id", rentalId)
    .maybeSingle();

  const missing: string[] = [];
  if (!ver?.license_front_url) missing.push("license_front");
  if (!ver?.license_back_url) missing.push("license_back");
  if (!ver?.selfie_url) missing.push("selfie");
  if (!ver?.license_state) missing.push("license_state");
  if (!ver?.license_expires) missing.push("license_expires");

  const complete = missing.length === 0;

  if (complete) {
    await supabaseAdmin
      .from("rentals")
      .update({ docs_complete: true, verification_status: "pending" })
      .eq("id", rentalId)
      .eq("user_id", userId);

    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: userId,
      actor_role: "renter",
      event_type: "verification_submitted",
      event_payload: {},
    });
  }

  return { complete, missing };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);

    const contentType = req.headers.get("content-type") || "";

    // --------------------------------------------
    // A) MULTIPART FORM UPLOAD (kind + file)
    // --------------------------------------------
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();

      const rentalId = asString(fd.get("rentalId"));
      const kindRaw = asString(fd.get("kind"));
      const file = fd.get("file");

      // Optional fields (may be sent on any call)
      const licenseState = asString(fd.get("licenseState"));
      const licenseExpires = asString(fd.get("licenseExpires")); // YYYY-MM-DD
      const hasInsurance = asBool(fd.get("hasInsurance"));

      const capturedLat = asNumberOrNull(fd.get("capturedLat"));
      const capturedLng = asNumberOrNull(fd.get("capturedLng"));
      const capturedAccuracyM = asNumberOrNull(fd.get("capturedAccuracyM"));

      if (!rentalId) {
        return NextResponse.json(
          { error: "Missing rentalId" },
          { status: 400 }
        );
      }

      const kind = kindRaw as Kind;
      const allowed: Kind[] = ["license_front", "license_back", "selfie"];
      if (!allowed.includes(kind)) {
        return NextResponse.json(
          { error: "Invalid kind. Use license_front, license_back, or selfie." },
          { status: 400 }
        );
      }

      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "Missing file" },
          { status: 400 }
        );
      }

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

      // Upload to storage
      const bucket = pickBucket(kind);
      const ext = safeFilename(file.name || "upload.jpg");
      const path = `${rentalId}/${kind}-${Date.now()}-${ext}`;

      const bytes = Buffer.from(await file.arrayBuffer());

      const up = await supabaseAdmin.storage.from(bucket).upload(path, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

      if (up.error) {
        return NextResponse.json(
          { error: up.error.message },
          { status: 400 }
        );
      }

      // Store as a stable internal reference (private bucket)
      const ref = `supabase://${bucket}/${path}`;

      // Upsert verification row (one per rental)
      const patch: any = {
        rental_id: rentalId,
        user_id: user.id,
        ...setFieldForKind(kind, ref),

        // save metadata if provided (don’t require on each upload)
        ...(licenseState ? { license_state: licenseState } : {}),
        ...(licenseExpires ? { license_expires: licenseExpires } : {}),
        has_insurance: hasInsurance,

        captured_lat: capturedLat,
        captured_lng: capturedLng,
        captured_accuracy_m: capturedAccuracyM,
        captured_at: new Date().toISOString(),
      };

      const { error: upErr } = await supabaseAdmin
        .from("renter_verifications")
        .upsert(patch, { onConflict: "rental_id" });

      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 400 });
      }

      // Mark docs complete ONLY when ALL required fields are present
      const { complete, missing } = await finalizeDocsIfComplete(
        rentalId,
        user.id
      );

      return NextResponse.json(
        {
          ok: true,
          uploaded: { kind, ref },
          docs_complete: complete,
          missing,
        },
        { status: 200 }
      );
    }

    // --------------------------------------------
    // B) JSON MODE (urls already uploaded elsewhere)
    // --------------------------------------------
    const body = await req.json().catch(() => ({}));

    const rentalId = asString(body?.rentalId);
    const licenseFrontUrl = asString(body?.licenseFrontUrl);
    const licenseBackUrl = asString(body?.licenseBackUrl);
    const selfieUrl = asString(body?.selfieUrl);

    const licenseState = asString(body?.licenseState);
    const licenseExpires = asString(body?.licenseExpires); // "YYYY-MM-DD"
    const hasInsurance = !!body?.hasInsurance;

    const capturedLat = body?.capturedLat ?? null;
    const capturedLng = body?.capturedLng ?? null;
    const capturedAccuracyM = body?.capturedAccuracyM ?? null;

    if (!rentalId || !licenseFrontUrl || !licenseBackUrl || !selfieUrl) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }
    if (!licenseState || !licenseExpires) {
      return NextResponse.json(
        { error: "Missing license state/expiry" },
        { status: 400 }
      );
    }

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

    const { error: upErr } = await supabaseAdmin.from("renter_verifications").upsert(
      {
        rental_id: rentalId,
        user_id: user.id,
        license_front_url: licenseFrontUrl,
        license_back_url: licenseBackUrl,
        selfie_url: selfieUrl,
        license_state: licenseState,
        license_expires: licenseExpires,
        has_insurance: hasInsurance,
        captured_lat: capturedLat,
        captured_lng: capturedLng,
        captured_accuracy_m: capturedAccuracyM,
        captured_at: new Date().toISOString(),
      },
      { onConflict: "rental_id" }
    );

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    await supabaseAdmin
      .from("rentals")
      .update({ docs_complete: true, verification_status: "pending" })
      .eq("id", rentalId)
      .eq("user_id", user.id);

    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "verification_submitted",
      event_payload: { has_insurance: hasInsurance },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}