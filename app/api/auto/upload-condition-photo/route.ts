import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

type Phase = "pickup_exterior" | "pickup_interior" | "return_exterior" | "return_interior";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const rentalId = String(form.get("rentalId") || "");
    const phase = String(form.get("phase") || "") as Phase;
    const photo = form.get("photo") as File | null;

    const lat = form.get("lat") ? Number(form.get("lat")) : null;
    const lng = form.get("lng") ? Number(form.get("lng")) : null;
    const accuracy = form.get("accuracy") ? Number(form.get("accuracy")) : null;

    if (!rentalId || !photo) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    if (!["pickup_exterior","pickup_interior","return_exterior","return_interior"].includes(phase)) {
      return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
    }

    // Ensure rental belongs to user
    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select("id,user_id,paid,verification_status,lockbox_code,condition_photos_status")
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    if (rental.user_id !== u.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Gating rules:
    // pickup_exterior allowed after approval+paid (prevents random uploads), but you can loosen later.
    if (phase === "pickup_exterior") {
      if (rental.verification_status !== "approved") return NextResponse.json({ error: "Awaiting admin approval." }, { status: 400 });
      if (!rental.paid) return NextResponse.json({ error: "Payment required before pickup photos." }, { status: 400 });
    }

    // pickup_interior allowed only after lockbox code exists (means admin assigned)
    if (phase === "pickup_interior") {
      if (!rental.lockbox_code) return NextResponse.json({ error: "Lockbox not ready yet." }, { status: 400 });
      if (!rental.paid) return NextResponse.json({ error: "Payment required." }, { status: 400 });
    }

    // return phases allowed only if paid
    if (phase.startsWith("return")) {
      if (!rental.paid) return NextResponse.json({ error: "Payment required." }, { status: 400 });
    }

    // Upload to Supabase Storage
    const bytes = Buffer.from(await photo.arrayBuffer());
    const ext = (photo.type || "image/jpeg").includes("png") ? "png" : "jpg";
    const path = `rentals/${rentalId}/${phase}/${Date.now()}.${ext}`;

    const storage = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    const up = await storage.storage.from("vehicle-images").upload(path, bytes, {
      contentType: photo.type || "image/jpeg",
      upsert: true,
    });

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    const publicUrl = storage.storage.from("vehicle-images").getPublicUrl(path).data.publicUrl;

    // Insert record
    const { error: insErr } = await supabase.from("rental_condition_photos").insert({
      rental_id: rentalId,
      user_id: u.user.id,
      phase,
      photo_url: publicUrl,
      captured_lat: Number.isFinite(lat as any) ? lat : null,
      captured_lng: Number.isFinite(lng as any) ? lng : null,
      captured_accuracy_m: Number.isFinite(accuracy as any) ? accuracy : null,
    });

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // Update status ladder
    const nextStatusMap: Record<Phase, string> = {
      pickup_exterior: "pickup_exterior_done",
      pickup_interior: "pickup_interior_done",
      return_exterior: "return_exterior_done",
      return_interior: "return_interior_done",
    };

    await supabase
      .from("rentals")
      .update({ condition_photos_status: nextStatusMap[phase] })
      .eq("id", rentalId);

    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: u.user.id,
      actor_role: "customer",
      event_type: "condition_photo_uploaded",
      event_payload: { phase, has_gps: !!(lat && lng) },
    });

    return NextResponse.json({ ok: true, url: publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}