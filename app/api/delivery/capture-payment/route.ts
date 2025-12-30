import { NextResponse } from "next/server";
import { capturePayment } from "../../../../lib/stripe/capturePayment";

export async function POST(req: Request) {
  try {
    const { orderId } = await req.json();

    if (!orderId) {
      return NextResponse.json(
        { error: "orderId is required" },
        { status: 400 }
      );
    }

    const intent = await capturePayment({ orderId });

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
