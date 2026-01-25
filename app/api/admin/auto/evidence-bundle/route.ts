export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

// Server-side Supabase (admin privileges enforced by RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rentalId = url.searchParams.get("rentalId");

    if (!rentalId) {
      return NextResponse.json(
        { error: "Missing rentalId" },
        { status: 400 }
      );
    }

    // ---------- AUTH (ADMIN ONLY) ----------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: userRes } = await supabaseAuth.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------- FETCH DATA ----------
    const zip = new JSZip();

    // 1️⃣ Rental record
    const { data: rental } = await supabase
      .from("rentals")
      .select("*")
      .eq("id", rentalId)
      .single();

    zip.file("rental.json", JSON.stringify(rental, null, 2));

    // 2️⃣ Renter verification
    const { data: verification } = await supabase
      .from("renter_verifications")
      .select("*")
      .eq("rental_id", rentalId)
      .single();

    zip.file(
      "verification.json",
      JSON.stringify(verification, null, 2)
    );

    // 3️⃣ Condition photos
    const { data: photos } = await supabase
      .from("rental_condition_photos")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at");

    zip.file(
      "condition_photos.json",
      JSON.stringify(photos || [], null, 2)
    );

    // 4️⃣ Rental events (timeline)
    const { data: events } = await supabase
      .from("rental_events")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at");

    zip.file(
      "timeline.json",
      JSON.stringify(events || [], null, 2)
    );

    // ---------- BUILD ZIP ----------
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBuffer = Buffer.from(zipBytes);

    const filename = `couranr-evidence-${rentalId}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.zip`;

    // ---------- AUDIT LOG ----------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "admin",
      event_type: "evidence_bundle_downloaded",
      event_payload: { filename },
    });

    // ---------- RESPONSE ----------
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error("Evidence bundle error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to generate evidence bundle" },
      { status: 500 }
    );
  }
}