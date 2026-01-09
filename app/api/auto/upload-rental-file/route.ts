import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function extFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  return "jpg";
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // Validate user (RLS will also enforce)
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userRes.user.id;

    const form = await req.formData();
    const rentalId = String(form.get("rentalId") || "");
    const kind = String(form.get("kind") || "");
    const file = form.get("file") as File | null;

    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    if (!kind) return NextResponse.json({ error: "Missing kind" }, { status: 400 });
    if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

    const allowed = new Set([
      "license_front",
      "license_back",
      "pre_exterior",
      "pre_interior",
      "post_exterior",
      "post_interior",
    ]);
    if (!allowed.has(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }

    // Upload path
    const ext = extFromName(file.name);
    const folder =
      kind.startsWith("license") ? "license" : "condition";

    const path = `${folder}/${rentalId}/${kind}.${ext}`;

    const bytes = new Uint8Array(await file.arrayBuffer());

    const up = await supabase.storage
      .from("rental-files")
      .upload(path, bytes, {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from("rental-files").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    // Record in DB
    const { error: insErr } = await supabase
      .from("rental_uploads")
      .insert({
        rental_id: rentalId,
        user_id: userId,
        kind,
        file_url: publicUrl,
      });

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // Update gating flags on rentals (docs/condition complete)
    // docs_complete: both license files exist
    // condition_photos_complete: both pre photos exist
    const { data: uploads } = await supabase
      .from("rental_uploads")
      .select("kind")
      .eq("rental_id", rentalId)
      .eq("user_id", userId);

    const kinds = new Set((uploads || []).map((x: any) => x.kind));

    const docsComplete = kinds.has("license_front") && kinds.has("license_back");
    const conditionComplete = kinds.has("pre_exterior") && kinds.has("pre_interior");

    await supabase
      .from("rentals")
      .update({
        docs_complete: docsComplete,
        condition_photos_complete: conditionComplete,
      })
      .eq("id", rentalId);

    return NextResponse.json({ ok: true, url: publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}