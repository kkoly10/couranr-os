import { NextResponse } from "next/server";
import { completeDelivery } from "@/lib/delivery/completeDelivery";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const { orderId } = await req.json();

    if (!orderId) {
      return NextResponse.json(
        { error: "Missing orderId" },
        { status: 400 }
      );
    }

    // Verify drop-off photo exists
    const { data: photos } = await supabase
      .from("delivery_photos")
      .select("*")
      .eq("order_id", orderId)
      .eq("type", "dropoff");

    if (!photos || photos.length === 0) {
      return NextResponse.json(
        { error: "Drop-off photo required" },
        { status: 403 }
      );
    }

    const completed = await completeDelivery(orderId);

    return NextResponse.json({ success: true, order: completed });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to complete delivery" },
      { status: 500 }
    );
  }
}