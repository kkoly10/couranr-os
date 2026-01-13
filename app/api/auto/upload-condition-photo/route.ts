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
    // -----------------------------
    // Auth
    // -----------------------------
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
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    );

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = userRes.user.id;

    // -----------------------------
    // Parse request
    // -----------------------------
    const body = await req.json();

    const {
      rentalId,
      phase, // pickup_exterior | pickup_interior | return_exterior | return_interior
      photoBase64,
      capturedLat,
      capturedLng,
      capturedAccuracyM,
    } = body || {};

    if (!rentalId || !phase || !photoBase64) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // -----------------------------
    // Validate rental ownership
    // -----------------------------
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select("id, user_id")
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental || rental.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // -----------------------------
    // Decode image
    // -----------------------------
    const matches = photoBase64.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json({ error: "Invalid image data" }, { status: 400 });
    }

    const contentType = matches[1];
    const buffer = Buffer.from(matches[2], "base64");

    // -----------------------------
    // Generate filename (NO uuid pkg)
    // -----------------------------
    const photoId = crypto.randomUUID();
    const filePath = `rentals/${rentalId}/${phase}/${photoId}.jpg`;

    // -----------------------------
    // Upload to storage
    // -----------------------------
    const { error: uploadErr } = await supabase.storage
      .from("renter-verifications")
      .upload(filePath, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: uploadErr.message },
        { status: 500 }
      );
    }

    const { data: publicUrl } = supabase.storage
      .from("renter-verifications")
      .getPublicUrl(filePath);

    // -----------------------------
    // Insert DB record
    // -----------------------------
    const { error: insertErr } = await supabase
      .from("rental_condition_photos")
      .insert({
        rental_id: rentalId,
        user_id: userId,
        phase,
        photo_url: publicUrl.publicUrl,
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

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("Upload condition photo error:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}