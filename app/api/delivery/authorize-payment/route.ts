
import { NextResponse } from "next/server";
import { stripe } from "../../../../lib/stripe";
import { supabase } from "../../../../lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const { orderId, amountCents } = await req.json();

    if (!orderId || !amountCents || amountCents < 50) {
      return NextResponse.json(
        { error: "orderId and valid amountCents are required" },
        { status: 400 }
      );
    }

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      capture_method: "manual",
      automatic_payment_methods: { enabled: true },
    });

    await supabase
      .from("orders")
      .update({
        stripe_payment_intent_id: intent.id,
        payment_status: "authorized",
      })
      .eq("id", orderId);

    return NextResponse.json({
      clientSecret: intent.client_secret,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to authorize payment" },
      { status: 500 }
    );
  }
}
