import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { deliveryId, photoUrl } = body;

    if (!deliveryId || !photoUrl) {
      return NextResponse.json(
        { error: "deliveryId and photoUrl are required" },
        { status: 400 }
      );
    }

    // 1) Insert pickup photo
    const { error: photoError } = await supabaseAdmin
      .from("delivery_photos")
      .insert({
        delivery_id: deliveryId,
        photo_type: "pickup",
        photo_url: photoUrl,
        uploaded_by: "customer",
      });

    if (photoError) throw photoError;

    // 2) Move delivery to ready_for_dispatch
    const { error: statusError } = await supabaseAdmin
      .from("deliveries")
      .update({ status: "ready_for_dispatch" })
      .eq("id", deliveryId);

    if (statusError) throw statusError;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Upload failed" },
      { status: 500 }
    );
  }
}
