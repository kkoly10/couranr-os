import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { deliveryId, driverId } = body;

    if (!deliveryId || !driverId) {
      return NextResponse.json(
        { error: "deliveryId and driverId are required" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("deliveries")
      .update({
        driver_id: driverId,
        status: "assigned",
      })
      .eq("id", deliveryId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Assignment failed" },
      { status: 500 }
    );
  }
}
