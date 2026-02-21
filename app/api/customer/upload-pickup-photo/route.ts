import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    // 1️⃣ Auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    // 2️⃣ Supabase client (user-scoped)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    // 3️⃣ Get user
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 4️⃣ Parse form data
    const formData = await req.formData();
    
    // ✅ FIX: Look for "photo" (what frontend sends) OR "file"
    const file = (formData.get("photo") || formData.get("file")) as File | null;
    const deliveryId = formData.get("deliveryId") as string | null;

    if (!file || !deliveryId) {
      return NextResponse.json(
        { error: "Missing file or deliveryId" },
        { status: 400 }
      );
    }

    // 5️⃣ Fetch delivery + owning order
    const { data: delivery, error: deliveryErr } = await supabase
      .from("deliveries")
      .select(`
        id,
        orders (
          customer_id
        )
      `)
      .eq("id", deliveryId)
      .single();

    // ✅ FIX: Safely handle if Supabase returns `orders` as an Array OR an Object
    const orderData = Array.isArray(delivery?.orders) 
      ? delivery?.orders[0] 
      : delivery?.orders;

    if (
      deliveryErr ||
      !delivery ||
      !orderData ||
      orderData.customer_id !== user.id
    ) {
      return NextResponse.json(
        { error: "Forbidden - You do not own this delivery" },
        { status: 403 }
      );
    }

    // 6️⃣ Upload to Storage
    const fileExt = file.name.split(".").pop();
    const path = `pickup/${deliveryId}-${Date.now()}.${fileExt}`;

    const { error: uploadErr } = await supabase.storage
      .from("delivery-photos")
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      console.error("Upload error:", uploadErr);
      return NextResponse.json(
        { error: "Upload failed" },
        { status: 500 }
      );
    }

    // 7️⃣ Public URL
    const { data: urlData } = supabase.storage
      .from("delivery-photos")
      .getPublicUrl(path);

    // 8️⃣ Insert DB record
    const { error: insertErr } = await supabase
      .from("delivery_photos")
      .insert({
        delivery_id: deliveryId,
        photo_type: "pickup",
        photo_url: urlData.publicUrl,
        uploaded_by: "customer",
      });

    if (insertErr) {
      console.error("DB insert error:", insertErr);
      return NextResponse.json(
        { error: "Failed to save photo record" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Upload fatal error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
