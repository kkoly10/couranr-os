import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const form = await req.formData();
    const rentalId = String(form.get("rentalId") || "");
    const phase = String(form.get("phase") || "");
    const photo = form.get("photo") as File;

    if (!rentalId || !phase || !photo) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const lat = form.get("lat");
    const lng = form.get("lng");
    const accuracy = form.get("accuracy");

    const filePath = `condition/${rentalId}/${phase}/${uuidv4()}.jpg`;

    const { error: uploadErr } = await supabase.storage
      .from("renter-verifications")
      .upload(filePath, photo, { contentType: photo.type });

    if (uploadErr) throw uploadErr;

    const { data: url } = supabase.storage
      .from("renter-verifications")
      .getPublicUrl(filePath);

    const { error: insertErr } = await supabase
      .from("rental_condition_photos")
      .insert({
        rental_id: rentalId,
        user_id: (await supabase.auth.getUser(token)).data.user?.id,
        phase,
        photo_url: url.publicUrl,
        captured_lat: lat ? Number(lat) : null,
        captured_lng: lng ? Number(lng) : null,
        captured_accuracy_m: accuracy ? Number(accuracy) : null,
      });

    if (insertErr) throw insertErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Upload failed" },
      { status: 500 }
    );
  }
}