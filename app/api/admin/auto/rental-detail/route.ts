import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseSupabaseStorageUrl(u: string): { bucket: string; path: string } | null {
  // Expected: supabase://bucket/path/to/file.jpg
  if (!u || typeof u !== "string") return null;
  if (!u.startsWith("supabase://")) return null;
  const rest = u.replace("supabase://", "");
  const firstSlash = rest.indexOf("/");
  if (firstSlash <= 0) return null;
  const bucket = rest.slice(0, firstSlash);
  const path = rest.slice(firstSlash + 1);
  if (!bucket || !path) return null;
  return { bucket, path };
}

export async function GET(req: NextRequest) {
  try {
    // ✅ ADMIN AUTH (Bearer token) using your shared helper
    await requireAdmin(req);

    const url = new URL(req.url);
    const rentalId = url.searchParams.get("rentalId") || "";
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    // Client with admin privileges for reading + signing
    const supabaseAdmin = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    // ---- Rental core ----
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        renter_id,
        user_id,
        verification_status,
        verification_denial_reason,
        docs_complete,
        agreement_signed,
        paid,
        lockbox_code,
        lockbox_code_released_at,
        condition_photos_status,
        pickup_confirmed_at,
        return_confirmed_at,
        deposit_refund_status,
        deposit_refund_amount_cents,
        damage_confirmed,
        damage_confirmed_at,
        damage_notes,
        created_at,
        vehicles:vehicles ( id, year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ---- Verification row (if exists) ----
    const { data: rv } = await supabaseAdmin
      .from("renter_verifications")
      .select("*")
      .eq("rental_id", rentalId)
      .maybeSingle();

    // ---- Photos ----
    const { data: photosRaw } = await supabaseAdmin
      .from("rental_condition_photos")
      .select("phase, photo_url, captured_at, captured_lat, captured_lng, captured_accuracy_m, created_at")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    const photos = await Promise.all(
      (photosRaw || []).map(async (p: any) => {
        const parsed = parseSupabaseStorageUrl(p.photo_url);
        if (!parsed) {
          return { ...p, signed_url: null };
        }

        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from(parsed.bucket)
          .createSignedUrl(parsed.path, 60 * 10); // 10 minutes

        return {
          ...p,
          signed_url: signErr ? null : signed?.signedUrl || null,
          storage_bucket: parsed.bucket,
          storage_path: parsed.path,
        };
      })
    );

    return NextResponse.json({
      detail: {
        ...rental,
        renter_verifications: rv || null,
        photos,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      msg.includes("Missing authorization") || msg.includes("Invalid or expired token")
        ? 401
        : msg.includes("Admin access required")
        ? 403
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}