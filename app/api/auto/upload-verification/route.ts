import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const BUCKET = "rental-files";
const MAX_BYTES = 6 * 1024 * 1024; // 6MB

function safeExt(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return null;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // User client (RLS + identity)
    const supabaseUser = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: u, error: uErr } = await supabaseUser.auth.getUser();
    if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const rentalId = String(form.get("rentalId") || "");
    const kind = String(form.get("kind") || "");
    const file = form.get("file") as File | null;

    if (!rentalId || !file || !["license_front", "license_back", "selfie"].includes(kind)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 6MB)" }, { status: 400 });
    }

    const ext = safeExt(file.type);
    if (!ext) {
      return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
    }

    // Ownership validation (no leakage)
    const { data: r, error: rErr } = await supabaseUser
      .from("rentals")
      .select("id, user_id")
      .eq("id", rentalId)
      .single();

    if (rErr || !r) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    if (r.user_id !== u.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Service client for private storage upload
    const supabaseSvc = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const path = `auto/${u.user.id}/${rentalId}/verification/${kind}.${ext}`;

    const buf = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await supabaseSvc.storage.from(BUCKET).upload(path, buf, {
      contentType: file.type,
      upsert: true,
    });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Insert file record (use user client so RLS applies)
    const { error: insErr } = await supabaseUser.from("rental_files").insert({
      rental_id: rentalId,
      user_id: u.user.id,
      kind,
      storage_bucket: BUCKET,
      storage_path: path,
    });

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // Mark docs_complete if all 3 exist
    const { data: files } = await supabaseUser
      .from("rental_files")
      .select("kind")
      .eq("rental_id", rentalId)
      .eq("user_id", u.user.id);

    const kinds = new Set((files || []).map((x: any) => x.kind));
    const docsComplete = ["license_front", "license_back", "selfie"].every((k) => kinds.has(k));

    if (docsComplete) {
      await supabaseUser.from("rentals").update({ docs_complete: true }).eq("id", rentalId);
    }

    return NextResponse.json({ success: true, docsComplete });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}