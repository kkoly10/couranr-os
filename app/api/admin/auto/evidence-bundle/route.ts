import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

type RentalRow = {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  purpose: string | null;
  status: string | null;
  pickup_at: string | null;
  pickup_location: string | null;
  created_at: string;
  paid: boolean;
  paid_at: string | null;
  agreement_signed: boolean;
  docs_complete: boolean;
  verification_status: string;
  verification_denial_reason: string | null;
  lockbox_code_released_at: string | null;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
  condition_photos_status: string;
  deposit_refund_status: string;
  deposit_refund_amount_cents: number;
  damage_confirmed?: boolean;
  damage_confirmed_at?: string | null;
  damage_notes?: string | null;
};

type VerificationRow = {
  id: string;
  rental_id: string;
  user_id: string;
  license_front_url: string;
  license_back_url: string;
  selfie_url: string;
  license_state: string;
  license_expires: string;
  has_insurance: boolean;
  captured_lat: number | null;
  captured_lng: number | null;
  captured_accuracy_m: number | null;
  captured_at: string;
  created_at: string;
};

type ConditionPhotoRow = {
  id: string;
  rental_id: string;
  user_id: string;
  phase: "pickup_exterior" | "pickup_interior" | "return_exterior" | "return_interior";
  photo_url: string;
  captured_lat: number | null;
  captured_lng: number | null;
  captured_accuracy_m: number | null;
  captured_at: string;
  created_at: string;
};

function safeName(s: string) {
  return String(s || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 120);
}

/**
 * photo_url / selfie_url may be:
 * - full http(s) URL
 * - "bucket/path/to/object.jpg"
 * We'll try to fetch it either way.
 */
async function resolveToFetchUrl(
  supabaseService: any,
  urlOrPath: string,
  ttlSeconds = 600
): Promise<string> {
  const raw = String(urlOrPath || "").trim();
  if (!raw) throw new Error("Empty file reference");

  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  // Assume "bucket/path..."
  const firstSlash = raw.indexOf("/");
  if (firstSlash === -1) throw new Error(`Unrecognized storage path: ${raw}`);

  const bucket = raw.slice(0, firstSlash);
  const path = raw.slice(firstSlash + 1);

  const { data, error } = await supabaseService.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed signed URL for ${bucket}/${path}: ${error?.message || "unknown"}`);
  }
  return data.signedUrl;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${url} (${res.status})`);
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

async function isAdmin(supabaseService: any, userId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) return false;
  return data?.role === "admin";
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseService = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Validate token
    const { data: userRes, error: userErr } = await supabaseService.auth.getUser(token);
    const user = userRes?.user;
    if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = await isAdmin(supabaseService, user.id);
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "").trim();
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    // Rental
    const { data: rental, error: rentalErr } = await supabaseService
      .from("rentals")
      .select(
        `
        id,
        user_id,
        vehicle_id,
        purpose,
        status,
        pickup_at,
        pickup_location,
        created_at,
        paid,
        paid_at,
        agreement_signed,
        docs_complete,
        verification_status,
        verification_denial_reason,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at,
        condition_photos_status,
        deposit_refund_status,
        deposit_refund_amount_cents,
        damage_confirmed,
        damage_confirmed_at,
        damage_notes
      `
      )
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Verification row (optional)
    const { data: verification } = await supabaseService
      .from("renter_verifications")
      .select(
        `
        id,
        rental_id,
        user_id,
        license_front_url,
        license_back_url,
        selfie_url,
        license_state,
        license_expires,
        has_insurance,
        captured_lat,
        captured_lng,
        captured_accuracy_m,
        captured_at,
        created_at
      `
      )
      .eq("rental_id", rentalId)
      .maybeSingle();

    // Condition photos
    const { data: photos } = await supabaseService
      .from("rental_condition_photos")
      .select(
        `
        id,
        rental_id,
        user_id,
        phase,
        photo_url,
        captured_lat,
        captured_lng,
        captured_accuracy_m,
        captured_at,
        created_at
      `
      )
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    // Events
    const { data: events } = await supabaseService
      .from("rental_events")
      .select("id,rental_id,actor_user_id,actor_role,event_type,event_payload,created_at")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    // Build ZIP
    const zip = new JSZip();

    // Manifest
    const manifest = {
      generatedAt: new Date().toISOString(),
      generatedByAdminUserId: user.id,
      rental: rental as RentalRow,
      verification: (verification as VerificationRow) || null,
      conditionPhotos: (photos as ConditionPhotoRow[]) || [],
      events: events || [],
      notes: {
        gpsDisclaimer:
          "GPS values come from browser geolocation at upload time. They can be missing or inaccurate depending on device settings.",
      },
    };

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    // Evidence folders
    const idFolder = zip.folder("id_verification");
    const photoFolder = zip.folder("condition_photos");

    // Add ID images (best effort)
    if (verification) {
      const v = verification as VerificationRow;

      // helper to add file
      const add = async (label: string, ref: string) => {
        try {
          const url = await resolveToFetchUrl(supabaseService, ref);
          const bytes = await fetchBytes(url);
          // Try to keep extension
          const ext = ref.includes(".") ? ref.split(".").pop() : "jpg";
          idFolder?.file(`${label}.${safeName(ext || "jpg")}`, bytes);
          return { ok: true };
        } catch (e: any) {
          // store error note instead of failing the whole bundle
          idFolder?.file(`${label}.txt`, `Failed to fetch: ${String(e?.message || e)}`);
          return { ok: false };
        }
      };

      await add("license_front", v.license_front_url);
      await add("license_back", v.license_back_url);
      await add("selfie", v.selfie_url);
    } else {
      idFolder?.file("README.txt", "No renter_verifications row found for this rental.");
    }

    // Add condition photos (best effort)
    const pRows = (photos as ConditionPhotoRow[]) || [];
    if (!pRows.length) {
      photoFolder?.file("README.txt", "No rental_condition_photos rows found for this rental.");
    } else {
      // Group by phase
      for (let i = 0; i < pRows.length; i++) {
        const p = pRows[i];
        const phaseFolder = photoFolder?.folder(p.phase);
        const fileBase = `${String(i + 1).padStart(3, "0")}_${safeName(p.id)}`;

        try {
          const url = await resolveToFetchUrl(supabaseService, p.photo_url);
          const bytes = await fetchBytes(url);

          // Guess ext
          const extGuess =
            p.photo_url.includes(".") ? p.photo_url.split(".").pop() : "jpg";

          phaseFolder?.file(`${fileBase}.${safeName(extGuess || "jpg")}`, bytes);

          // Add metadata per photo
          phaseFolder?.file(
            `${fileBase}.json`,
            JSON.stringify(
              {
                id: p.id,
                phase: p.phase,
                captured_at: p.captured_at,
                captured_lat: p.captured_lat,
                captured_lng: p.captured_lng,
                captured_accuracy_m: p.captured_accuracy_m,
                created_at: p.created_at,
              },
              null,
              2
            )
          );
        } catch (e: any) {
          phaseFolder?.file(
            `${fileBase}.txt`,
            `Failed to fetch photo_url: ${p.photo_url}\nError: ${String(e?.message || e)}`
          );
        }
      }
    }

    // Audit: log bundle download (does not block)
    try {
      await supabaseService.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: user.id,
        actor_role: "admin",
        event_type: "evidence_bundle_downloaded",
        event_payload: { method: "admin_api_zip" },
      });
    } catch {
      // ignore
    }

    const zipBytes = await zip.generateAsync({ type: "uint8array" });

    const filename = `couranr_evidence_${safeName(rentalId)}_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.zip`;

    return new NextResponse(zipBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("evidence-bundle error:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}