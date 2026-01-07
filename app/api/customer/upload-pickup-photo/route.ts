import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

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

    const formData = await req.formData();
    const deliveryId = formData.get("deliveryId") as string;
    const file = formData.get("file") as File;

    if (!deliveryId || !file) {
      return NextResponse.json(
        { error: "Missing deliveryId or file" },
        { status: 400 }
      );
    }

    // Upload to storage
    const filePath = `pickup/${deliveryId}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("delivery-photos")
      .upload(filePath, file, {
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      );
    }

    const { data: publicUrl } = supabase.storage
      .from("delivery-photos")
      .getPublicUrl(filePath);

    // Insert DB record
    const { error: insertError } = await supabase
      .from("delivery_photos")
      .insert({
        delivery_id: deliveryId,
        photo_type: "pickup",
        photo_url: publicUrl.publicUrl,
        uploaded_by: "customer",
      });

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Upload failed" },
      { status: 500 }
    );
  }
}