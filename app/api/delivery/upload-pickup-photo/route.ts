import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { signedUrlTtlSeconds } from "@/lib/delivery/deliveryAccess";
import {
  assertPersistableRef,
  buildStorageRef,
  createDeliveryPhotoSignedUrl,
} from "@/lib/delivery/deliveryPhotoRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanName(name: string) {
  return (name || "photo")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extFromFile(file: File) {
  const fromName = (file.name || "").split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;

  const t = (file.type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("heic")) return "heic";
  return "jpg";
}

async function insertDeliveryPhotoRow(params: {
  deliveryId: string;
  photoRef: string;
}) {
  const { deliveryId, photoRef } = params;

  // One insert, one known shape. The previous version tried four different row
  // shapes in sequence and kept the first that did not error — the same
  // swallow-and-retry pattern as `resilientUpdateById`, which can "succeed"
  // having persisted none of the intended columns. `delivery_photos` is
  // (id, delivery_id, photo_type, photo_url, uploaded_by, created_at); if that
  // ever changes, this should fail loudly rather than silently degrade.
  const { error } = await supabaseAdmin.from("delivery_photos").insert({
    delivery_id: deliveryId,
    photo_type: "pickup",
    photo_url: photoRef,
    uploaded_by: "customer",
  });

  if (error) return { ok: false as const, errors: [error.message] };
  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    // ---------------- Auth ----------------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Identify user using JWT
    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ---------------- Parse multipart form ----------------
    const form = await req.formData();

    const deliveryId = String(form.get("deliveryId") || "").trim();
    // Make orderId optional to avoid frontend mismatch breaking upload
    const orderIdFromBody = String(form.get("orderId") || "").trim() || null;

    // Accept both "photo" and "file"
    const photo = (form.get("photo") as File | null) || (form.get("file") as File | null);

    if (!deliveryId) {
      return NextResponse.json({ error: "Missing deliveryId" }, { status: 400 });
    }
    if (!photo) {
      return NextResponse.json({ error: "Missing photo" }, { status: 400 });
    }

    // ---------------- Ownership check ----------------
    let q = supabaseAdmin
      .from("deliveries")
      .select(
        `
          id,
          order_id,
          orders!inner(customer_id)
        `
      )
      .eq("id", deliveryId);

    if (orderIdFromBody) {
      q = q.eq("order_id", orderIdFromBody);
    }

    const { data: deliveryRow, error: deliveryErr } = await q.single();

    if (deliveryErr || !deliveryRow) {
      return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
    }

    const ordersRel = (deliveryRow as any)?.orders;
    const customerId = Array.isArray(ordersRel)
      ? ordersRel[0]?.customer_id
      : ordersRel?.customer_id;

    if (!customerId || customerId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------------- Upload to Storage ----------------
    const bucket = "delivery-photos";
    const ext = extFromFile(photo);
    const safe = cleanName(photo.name || "photo");
    const path = `pickup/${deliveryId}/${Date.now()}-${safe.replace(/\.[^.]+$/, "")}.${ext}`;

    const bytes = new Uint8Array(await photo.arrayBuffer());

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType: photo.type || "image/jpeg",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: uploadErr.message || "Upload failed" },
        { status: 500 }
      );
    }

    // The bucket is PRIVATE. getPublicUrl() would still return a string without
    // contacting storage, so it fails silently rather than loudly — the URL just
    // 400s when a browser fetches it. Persist a storage reference instead and
    // hand back a short-lived signed URL for immediate display.
    const photoRef = assertPersistableRef(buildStorageRef(bucket, path));

    // ---------------- Insert DB record ----------------
    const inserted = await insertDeliveryPhotoRow({ deliveryId, photoRef });

    if (!inserted.ok) {
      // Do not leave an orphaned object behind when the row could not be written.
      await supabaseAdmin.storage.from(bucket).remove([path]);

      return NextResponse.json(
        {
          error: "Photo uploaded but DB record insert failed",
          details: inserted.errors,
        },
        { status: 500 }
      );
    }

    // Issued to the uploader, who was just verified as the owning customer.
    // Returned in the response only — never persisted, never logged.
    const signedUrl = await createDeliveryPhotoSignedUrl(
      photoRef,
      signedUrlTtlSeconds("customer")
    );

    return NextResponse.json({
      success: true,
      url: signedUrl,
      expiresInSeconds: signedUrlTtlSeconds("customer"),
      storage_path: path,
    });
  } catch (err: any) {
    console.error("upload-pickup-photo error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
