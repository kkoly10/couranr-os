export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

const DELIVERY_PHOTOS_BUCKET = "delivery-photos";
const MAX_PHOTO_SIZE = 15 * 1024 * 1024;

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function cleanName(name: string) {
  return (name || "photo")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

async function ensureBucket(supabase: ReturnType<typeof svc>) {
  const { data: bucket, error: getErr } = await supabase.storage.getBucket(
    DELIVERY_PHOTOS_BUCKET
  );
  if (bucket && !getErr) return;

  const { error: createErr } = await supabase.storage.createBucket(
    DELIVERY_PHOTOS_BUCKET,
    {
      public: false,
      fileSizeLimit: "15MB",
    }
  );

  if (
    createErr &&
    !String(createErr.message || "").toLowerCase().includes("already exists")
  ) {
    throw new Error(
      createErr.message || "Could not create delivery photos bucket"
    );
  }
}

export async function POST(req: NextRequest) {
  let uploadedPath: string | null = null;

  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    await ensureBucket(supabase);

    const formData = await req.formData();
    const file = (formData.get("photo") || formData.get("file")) as File | null;
    const deliveryId = String(formData.get("deliveryId") || "").trim();

    if (!file || !deliveryId) {
      return NextResponse.json(
        { error: "Missing file or deliveryId" },
        { status: 400 }
      );
    }

    if ((file.size || 0) > MAX_PHOTO_SIZE) {
      return NextResponse.json(
        { error: "Photo exceeds 15MB limit" },
        { status: 400 }
      );
    }

    const { data: delivery, error: deliveryErr } = await supabase
      .from("deliveries")
      .select(
        `
        id,
        order_id,
        orders:order_id (
          id,
          customer_id
        )
      `
      )
      .eq("id", deliveryId)
      .maybeSingle();

    if (deliveryErr || !delivery) {
      return NextResponse.json(
        { error: "Delivery not found" },
        { status: 404 }
      );
    }

    const order = Array.isArray((delivery as any).orders)
      ? (delivery as any).orders[0]
      : (delivery as any).orders;

    if (!order || String(order.customer_id || "") !== user.id) {
      return NextResponse.json(
        { error: "Forbidden - You do not own this delivery" },
        { status: 403 }
      );
    }

    const bytes = await file.arrayBuffer();
    const safeName = cleanName(file.name || "pickup-photo");
    uploadedPath = `${user.id}/${deliveryId}/${Date.now()}-${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from(DELIVERY_PHOTOS_BUCKET)
      .upload(uploadedPath, new Uint8Array(bytes), {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const storageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/${DELIVERY_PHOTOS_BUCKET}/${uploadedPath}`;

    const { error: insertErr } = await supabase.from("delivery_photos").insert({
      delivery_id: deliveryId,
      photo_type: "pickup",
      photo_url: storageUrl,
      storage_bucket: DELIVERY_PHOTOS_BUCKET,
      storage_path: uploadedPath,
      uploaded_by: "customer",
    });

    if (insertErr) {
      if (uploadedPath) {
        await supabase.storage.from(DELIVERY_PHOTOS_BUCKET).remove([uploadedPath]);
      }

      return NextResponse.json(
        { error: insertErr.message || "Failed to save photo record" },
        { status: 500 }
      );
    }

    await supabase.from("delivery_admin_events").insert({
      delivery_id: deliveryId,
      admin_user_id: null,
      event_type: "pickup_photo_uploaded",
      before_json: null,
      after_json: {
        uploaded_by: "customer",
        storage_bucket: DELIVERY_PHOTOS_BUCKET,
        storage_path: uploadedPath,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("pickup photo upload error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}