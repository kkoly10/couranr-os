export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { requireAdmin } from "@/app/lib/auth";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function safeJson(x: any) {
  return JSON.stringify(x ?? null, null, 2);
}

function parseSupabaseStorageUrl(u: string): { bucket: string; path: string } | null {
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

function guessExtFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  return "bin";
}

export async function GET(req: NextRequest) {
  try {
    // ✅ ADMIN auth
    const adminUser = await requireAdmin(req);

    const url = new URL(req.url);
    const rentalId = url.searchParams.get("rentalId") || "";
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    const supabaseAdmin = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    // ---------- FETCH DATA ----------
    const zip = new JSZip();

    // 1) Rental record
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select("*")
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }
    zip.file("rental.json", safeJson(rental));

    // 2) Renter verification
    const { data: verification } = await supabaseAdmin
      .from("renter_verifications")
      .select("*")
      .eq("rental_id", rentalId)
      .maybeSingle();

    zip.file("verification.json", safeJson(verification || null));

    // 3) Condition photos (rows)
    const { data: photos } = await supabaseAdmin
      .from("rental_condition_photos")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    zip.file("condition_photos.json", safeJson(photos || []));

    // 4) Timeline/events
    const { data: events } = await supabaseAdmin
      .from("rental_events")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    zip.file("timeline.json", safeJson(events || []));

    // ---------- ADD PHOTO FILES ----------
    // Safety limits so a malicious renter can’t explode bundle size
    const MAX_PHOTOS = 80;
    const photosToZip = (photos || []).slice(0, MAX_PHOTOS);

    const photoManifest: any[] = [];

    for (let i = 0; i < photosToZip.length; i++) {
      const p: any = photosToZip[i];
      const parsed = parseSupabaseStorageUrl(p.photo_url);
      if (!parsed) {
        photoManifest.push({ id: p.id, phase: p.phase, photo_url: p.photo_url, included: false, reason: "not_supabase_url" });
        continue;
      }

      const ext = guessExtFromPath(parsed.path);
      const filename = `photos/${String(i + 1).padStart(3, "0")}-${p.phase}-${p.id}.${ext}`;

      try {
        const { data, error } = await supabaseAdmin.storage
          .from(parsed.bucket)
          .download(parsed.path);

        if (error || !data) {
          photoManifest.push({ id: p.id, phase: p.phase, photo_url: p.photo_url, included: false, reason: error?.message || "download_failed" });
          continue;
        }

        const arrayBuffer = await data.arrayBuffer();
        zip.file(filename, Buffer.from(arrayBuffer));

        photoManifest.push({ id: p.id, phase: p.phase, included: true, file: filename });
      } catch (e: any) {
        photoManifest.push({ id: p.id, phase: p.phase, included: false, reason: e?.message || "exception" });
      }
    }

    zip.file("photo_manifest.json", safeJson(photoManifest));

    // ---------- BUILD ZIP ----------
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBuffer = Buffer.from(zipBytes);

    const filename = `couranr-evidence-${rentalId}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;

    // ---------- AUDIT LOG ----------
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: adminUser.id,
      actor_role: "admin",
      event_type: "evidence_bundle_downloaded",
      event_payload: { filename, photoCount: photosToZip.length },
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
    const msg = err?.message || "Failed to generate evidence bundle";
    const code =
      msg.includes("Missing authorization") || msg.includes("Invalid or expired token")
        ? 401
        : msg.includes("Admin access required")
        ? 403
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}