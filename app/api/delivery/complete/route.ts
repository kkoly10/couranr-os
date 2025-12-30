import { NextResponse } from "next/server";
import { completeDelivery } from "../../../../lib/delivery/completeDelivery";
import { supabase } from "../../../../lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: "Missing orderId" },
        { status: 400 }
      );
    }

    // Verify drop-off photo exists
    const { data: photos, error: photoErr } = await supabase
      .from("delivery_photos")
      .select("id")
      .eq("order_id", orderId)
      .eq("type", "dropoff")
      .limit(1);

    if (photoErr) {
      return NextResponse.json(
        { error: photoErr.message || "Failed to check drop-off photo" },
        { status: 500 }
      );
    }

    if (!photos || photos.length === 0) {
      return NextResponse.json(
        { error: "Drop-off photo required before payment capture." },
        { status: 403 }
      );
    }

    const completed = await completeDelivery(orderId);

    return NextResponse.json({
      success: true,
      order: completed,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to complete delivery" },
      { status: 500 }
    );
  }
}