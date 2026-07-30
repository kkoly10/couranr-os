import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  authorizeDeliveryAccess,
  signedUrlTtlSeconds,
} from "@/lib/delivery/deliveryAccess";
import { createDeliveryPhotoSignedUrl } from "@/lib/delivery/deliveryPhotoRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Issues short-lived signed URLs for one delivery's proof photos.
 *
 * The caller is resolved from a Bearer token via `getUser()` (which revalidates
 * the JWT with Supabase) and must be a Couranr Operations admin, the assigned
 * driver, or the owning customer. Signed URLs are returned in the response only
 * — never persisted, never logged.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getUserFromRequest(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let deliveryId = "";
  try {
    const body = await req.json();
    deliveryId = String(body?.deliveryId || "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!deliveryId) {
    return NextResponse.json(
      { error: "deliveryId is required" },
      { status: 400 }
    );
  }

  const decision = await authorizeDeliveryAccess(user.id, deliveryId);

  if (!decision.allowed) {
    // A missing delivery and an unauthorized one return the same 403 so this
    // route cannot be used to probe which delivery ids exist.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: photos, error } = await supabaseAdmin
    .from("delivery_photos")
    .select("id, photo_type, photo_url, created_at")
    .eq("delivery_id", deliveryId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Could not load delivery photos" },
      { status: 500 }
    );
  }

  const ttl = signedUrlTtlSeconds(decision.role!);

  const items = await Promise.all(
    (photos || []).map(async (p: any) => ({
      id: p.id,
      photoType: p.photo_type,
      createdAt: p.created_at,
      url: await createDeliveryPhotoSignedUrl(p.photo_url, ttl),
    }))
  );

  return NextResponse.json({
    deliveryId,
    role: decision.role,
    expiresInSeconds: ttl,
    photos: items.filter((i) => i.url),
  });
}
