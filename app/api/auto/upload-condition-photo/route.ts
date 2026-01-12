import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const BUCKET = "rental-files";
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

const PICKUP = { lat: 38.4149, lng: -77.4089 }; // replace later with exact coords
const GPS_RADIUS_M = 150;
const GPS_MAX_ACCURACY_M = 50;

function safeExt(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return null;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseUser = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: u, error: uErr } = await supabaseUser.auth.getUser();
    if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const rentalId = String(form.get("rentalId") || "");
    const stage = String(form.get("stage") || "");
    const view = String(form.get("view") || "");
    const file = form.get("file") as File | null;

    const lat = Number(form.get("lat"));
    const lng = Number(form.get("lng"));
    const accuracyM = Number(form.get("accuracyM"));
    const capturedAt = String(form.get("capturedAt") || "");

    if (!rentalId || !file || !stage || !view || !capturedAt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // IMPORTANT: block interior photos pre-unlock (loophole fix)
    if (stage !== "pickup_exterior") {
      return NextResponse.json({ error: "Only pickup exterior photos allowed at this step." }, { status: 400 });
    }

    if (!["front", "back", "left", "right"].includes(view)) {
      return NextResponse.json({ error: "Invalid photo view" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 8MB)" }, { status: 400 });

    const ext = safeExt(file.type);
    if (!ext) return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracyM)) {
      return NextResponse.json({ error: "Missing GPS metadata" }, { status: 400 });
    }

    if (accuracyM > GPS_MAX_ACCURACY_M) {
      return NextResponse.json({ error: `GPS accuracy too low (${accuracyM}m). Try again outdoors.` }, { status: 400 });
    }

    const dist = haversineMeters(lat, lng, PICKUP.lat, PICKUP.lng);
    if (dist > GPS_RADIUS_M) {
      return NextResponse.json({ error: "Upload must be at pickup location." }, { status: 403 });
    }

    // Ownership gate (no leakage)
    const { data: r, error: rErr } = await supabaseUser
      .from("rentals")
      .select("id, user_id")
      .eq("id", rentalId)
      .single();

    if (rErr || !r) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    if (r.user_id !== u.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Storage upload (private)
    const supabaseSvc = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const path = `auto/${u.user.id}/${rentalId}/condition/${stage}/${view}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabaseSvc.storage.from(BUCKET).upload(path, buf, {
      contentType: file.type,
      upsert: true,
    });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Insert record (RLS via user client)
    const { error: insErr } = await supabaseUser.from("rental_condition_photos").insert({
      rental_id: rentalId,
      user_id: u.user.id,
      stage,
      view,
      storage_bucket: BUCKET,
      storage_path: path,
      captured_at: new Date(capturedAt).toISOString(),
      lat,
      lng,
      accuracy_m: Math.round(accuracyM),
    });

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // Mark condition_photos_complete if all 4 views exist for pickup_exterior
    const { data: photos } = await supabaseUser
      .from("rental_condition_photos")
      .select("view")
      .eq("rental_id", rentalId)
      .eq("user_id", u.user.id)
      .eq("stage", "pickup_exterior");

    const views = new Set((photos || []).map((x: any) => x.view));
    const done = ["front", "back", "left", "right"].every((v) => views.has(v));

    if (done) {
      await supabaseUser.from("rentals").update({ condition_photos_complete: true }).eq("id", rentalId);
    }

    return NextResponse.json({ success: true, conditionPhotosComplete: done });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}