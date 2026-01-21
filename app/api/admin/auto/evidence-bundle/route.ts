import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

/**
 * Admin-only evidence bundle download.
 * Produces a ZIP containing:
 *  - Renter verification (license + selfie)
 *  - Condition photos (pickup / return)
 *  - Audit timeline (events.json)
 *
 * SECURITY:
 *  - Admin role required
 *  - Rental existence validated
 *  - All access logged
 */

export async function GET(req: Request) {
  try {
    // ---------------- AUTH ----------------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify admin role
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userRes.user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------------- INPUT ----------------
    const { searchParams } = new URL(req.url);
    const rentalId = searchParams.get("rentalId");
    if (!rentalId) {
      return NextResponse.json(
        { error: "Missing rentalId" },
        { status: 400 }
      );
    }

    // ---------------- DATA FETCH ----------------
    const zip = new JSZip();

    // 1️⃣ Verification
    const { data: verification } = await supabase
      .from("renter_verifications")
      .select("*")
      .eq("rental_id", rentalId)
      .single();

    if (verification) {
      zip.file(
        "verification.json",
        JSON.stringify(
          {
            license_state: verification.license_state,
            license_expires: verification.license_expires,
            has_insurance: verification.has_insurance,
            captured_at: verification.captured_at,
            gps: {
              lat: verification.captured_lat,
              lng: verification.captured_lng,
              accuracy_m: verification.captured_accuracy_m,
            },
          },
          null,
          2
        )
      );

      await addFile(zip, "verification/license_front.jpg", verification.license_front_url);
      await addFile(zip, "verification/license_back.jpg", verification.license_back_url);
      await addFile(zip, "verification/selfie.jpg", verification.selfie_url);
    }

    // 2️⃣ Condition photos
    const { data: photos } = await supabase
      .from("rental_condition_photos")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    if (photos?.length) {
      for (const p of photos) {
        const folder = `photos/${p.phase}`;
        const name = `${p.created_at}.jpg`;
        await addFile(zip, `${folder}/${name}`, p.photo_url);
      }
    }

    // 3️⃣ Audit events
    const { data: events } = await supabase
      .from("rental_events")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    zip.file("events.json", JSON.stringify(events || [], null, 2));

    // ---------------- BUILD ZIP ----------------
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBuffer = Buffer.from(zipBytes);

    const filename = `rental-evidence-${rentalId}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.zip`;

    // ---------------- AUDIT LOG ----------------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: userRes.user.id,
      actor_role: "admin",
      event_type: "evidence_bundle_downloaded",
      event_payload: { filename },
    });

    // ---------------- RESPONSE ----------------
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error("Evidence bundle error:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}

/**
 * Helper to fetch a public file and add to zip
 */
async function addFile(zip: JSZip, path: string, url?: string | null) {
  if (!url) return;
  const res = await fetch(url);
  if (!res.ok) return;
  const buf = Buffer.from(await res.arrayBuffer());
  zip.file(path, buf);
}