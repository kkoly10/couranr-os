import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  orderId: string | null;
  userId: string;
  photoUrl: string;
  storagePath: string;
  file: File;
}) {
  const { deliveryId, orderId, userId, photoUrl, storagePath, file } = params;

  // Try multiple row shapes so this works even if your table columns differ
  const attempts: Record<string, any>[] = [
    // Rich shape (common)
    {
      delivery_id: deliveryId,
      order_id: orderId,
      photo_type: "pickup",
      photo_url: photoUrl,
      uploaded_by: "customer",
      storage_bucket: "delivery-photos",
      storage_path: storagePath,
      file_name: file.name || "photo",
      mime_type: file.type || "image/jpeg",
      size_bytes: file.size ?? null,
      user_id: userId,
    },

    // Slightly different naming
    {
      delivery_id: deliveryId,
      order_id: orderId,
      phase: "pickup",
      photo_url: photoUrl,
      actor_role: "customer",
      storage_bucket: "delivery-photos",
      storage_path: storagePath,
      file_name: file.name || "photo",
      mime_type: file.type || "image/jpeg",
      size_bytes: file.size ?? null,
      user_id: userId,
    },

    // Minimal old shape (what your current code expects)
    {
      delivery_id: deliveryId,
      photo_type: "pickup",
      photo_url: photoUrl,
      uploaded_by: "customer",
    },

    // Minimal alternative
    {
      delivery_id: deliveryId,
      phase: "pickup",
      photo_url: photoUrl,
      user_id: userId,
    },
  ];

  const errors: string[] = [];

  for (const row of attempts) {
    const { error } = await supabaseAdmin.from("delivery_photos").insert(row);
    if (!error) return { ok: true as const };
    errors.push(error.message);
  }

  return { ok: false as const, errors };
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
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

    const resolvedOrderId = String((deliveryRow as any)?.order_id || orderIdFromBody || "");

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

    // Bucket is public in your project, so this is fine
    const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    const publicUrl = pub?.publicUrl || "";

    // ---------------- Insert DB record ----------------
    const inserted = await insertDeliveryPhotoRow({
      deliveryId,
      orderId: resolvedOrderId || null,
      userId: user.id,
      photoUrl: publicUrl,
      storagePath: path,
      file: photo,
    });

    if (!inserted.ok) {
      return NextResponse.json(
        {
          error: "Photo uploaded but DB record insert failed",
          details: inserted.errors,
          photo_url: publicUrl,
          storage_path: path,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      photo_url: publicUrl,
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
