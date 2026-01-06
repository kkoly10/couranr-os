import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const orderId = session.metadata?.orderId;
    if (!orderId) {
      return NextResponse.json(
        { error: "Order not found for session" },
        { status: 404 }
      );
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("order_number")
      .eq("id", orderId)
      .single();

    return NextResponse.json({
      orderNumber: order?.order_number ?? null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to retrieve order" },
      { status: 500 }
    );
  }
}