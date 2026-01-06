import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing session_id" },
        { status: 400 }
      );
    }

    // 1️⃣ Retrieve Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || !session.metadata?.orderId) {
      return NextResponse.json(
        { error: "Invalid Stripe session" },
        { status: 400 }
      );
    }

    const orderId = session.metadata.orderId;

    // 2️⃣ Fetch order using service role (NO auth required)
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("order_number")
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      orderNumber: order.order_number,
    });
  } catch (err: any) {
    console.error("Confirm delivery error:", err);
    return NextResponse.json(
      { error: "Failed to confirm order" },
      { status: 500 }
    );
  }
}