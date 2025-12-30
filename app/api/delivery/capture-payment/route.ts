import { NextResponse } from "next/server";
import { capturePayment } from "@/lib/stripe/capturePayment";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: "orderId is required" },
        { status: 400 }
      );
    }

    // 1️⃣ Capture the payment
    const intent = await capturePayment({ orderId });

    // 2️⃣ Respond with success
    return NextResponse.json({
      success: true,
      paymentIntentId: intent.id,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to capture payment" },
      { status: 500 }
    );
  }
}
