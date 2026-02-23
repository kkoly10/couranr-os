// app/api/admin/auto/evidence-bundle/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
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

async function getAdminUserIdFromRequest(req: NextRequest, supabaseAdmin: ReturnType<typeof createClient>) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

export async function GET(req: NextRequest) {
  try {
    // ✅ Admin auth guard
    await requireAdmin(req);

    const url = new URL(req.url);
    const rentalId = url.searchParams.get("rentalId") || "";
    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const adminUserId = await getAdminUserIdFromRequest(req, supabaseAdmin);

    const zip = new JSZip();

    // 1) Rental record
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select("*")
      .eq("id", rentalId)
      .maybeSingle();

    if (rentalErr) {
      return NextResponse.json({ error: `Failed to load rental: ${rentalErr.message}` }, { status: 500 });
    }
    if (!rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    zip.file("rental.json", safeJson(rental));

    // 2) Renter verification
    const { data: verification, error: verifyErr } = await supabaseAdmin
      .from("renter_verifications")
      .select("*")
      .eq("rental_id", rentalId)
      .maybeSingle();

    if (verifyErr) {
      zip.file("verification_error.json", safeJson({ error: verifyErr.message }));
    }
    zip.file("verification.json", safeJson(verification || null));

    // 3) Condition photos rows
    const { data: photos, error: photosErr } = await supabaseAdmin
      .from("rental_condition_photos")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    if (photosErr) {
      zip.file("condition_photos_error.json", safeJson({ error: photosErr.message }));
    }
    zip.file("condition_photos.json", safeJson(photos || []));

    // 4) Timeline/events
    const { data: events, error: eventsErr } = await supabaseAdmin
      .from("rental_events")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    if (eventsErr) {
      zip.file("timeline_error.json", safeJson({ error: eventsErr.message }));
    }
    zip.file("timeline.json", safeJson(events || []));

    // ---------- Add photo files ----------
    const MAX_PHOTOS = 80;
    const photosToZip = (photos || []).slice(0, MAX_PHOTOS);
    const photoManifest: any[] = [];

    for (let i = 0; i < photosToZip.length; i++) {
      const p: any = photosToZip[i];
      const parsed = parseSupabaseStorageUrl(p.photo_url);

      if (!parsed) {
        photoManifest.push({
          id: p.id,
          phase: p.phase,
          photo_url: p.photo_url,
          included: false,
          reason: "not_supabase_url",
        });
        continue;
      }

      const ext = guessExtFromPath(parsed.path);
      const filename = `photos/${String(i + 1).padStart(3, "0")}-${p.phase}-${p.id}.${ext}`;

      try {
        const { data, error } = await supabaseAdmin.storage
          .from(parsed.bucket)
          .download(parsed.path);

        if (error || !data) {
          photoManifest.push({
            id: p.id,
            phase: p.phase,
            photo_url: p.photo_url,
            included: false,
            reason: error?.message || "download_failed",
          });
          continue;
        }

        const arrayBuffer = await data.arrayBuffer();
        zip.file(filename, Buffer.from(arrayBuffer));

        photoManifest.push({
          id: p.id,
          phase: p.phase,
          included: true,
          file: filename,
        });
      } catch (e: any) {
        photoManifest.push({
          id: p.id,
          phase: p.phase,
          included: false,
          reason: e?.message || "exception",
        });
      }
    }

    zip.file("photo_manifest.json", safeJson(photoManifest));

    // ---------- Build ZIP ----------
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBuffer = Buffer.from(zipBytes);

    const filename = `couranr-evidence-${rentalId}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.zip`;

    // ---------- Audit log (best effort) ----------
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: adminUserId,
      actor_role: "admin",
      event_type: "evidence_bundle_downloaded",
      event_payload: { filename, photoCount: photosToZip.length },
    });

    // ---------- Response ----------
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
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