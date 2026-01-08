import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // Auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace("Bearer ", "").trim();

    // Use anon client with user's JWT to identify user
    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    );

    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse multipart form
    const form = await req.formData();
    const deliveryId = String(form.get("deliveryId") || "").trim();
    const orderId = String(form.get("orderId") || "").trim();
    const photo = form.get("photo") as File | null;

    if (!deliveryId || !orderId) {
      return NextResponse.json({ error: "Missing deliveryId or orderId" }, { status: 400 });
    }
    if (!photo) {
      return NextResponse.json({ error: "Missing photo" }, { status: 400 });
    }

    // Ownership check (prevents leakage)
    const { data: deliveryRow, error: deliveryErr } = await supabaseAdmin
      .from("deliveries")
      .select(
        `
        id,
        order_id,
        orders!inner(customer_id)
      `
      )
      .eq("id", deliveryId)
      .eq("order_id", orderId)
      .single();

    if (deliveryErr || !deliveryRow) {
      return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
    }

    const customerId = (deliveryRow as any)?.orders?.customer_id;
    if (!customerId || customerId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Upload to Storage using admin client
    const bucket = "delivery-photos";
    const ext = photo.name.split(".").pop() || "jpg";
    const path = `pickup/${deliveryId}/${Date.now()}.${ext}`;

    const bytes = new Uint8Array(await photo.arrayBuffer());

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType: photo.type || "image/jpeg",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    // Insert DB record (admin bypass)
    const { error: insertErr } = await supabaseAdmin.from("delivery_photos").insert({
      delivery_id: deliveryId,
      photo_type: "pickup",
      photo_url: publicUrl,
      uploaded_by: "customer",
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, url: publicUrl });
  } catch (err: any) {
    console.error("upload-pickup-photo error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}