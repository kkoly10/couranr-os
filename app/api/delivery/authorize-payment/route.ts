import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { orderId, amountCents } = body;

    if (!orderId || !amountCents || amountCents < 50) {
      return NextResponse.json(
        { error: "orderId and valid amountCents are required" },
        { status: 400 }
      );
    }

    // 1️⃣ Create PaymentIntent (AUTHORIZE ONLY)
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      capture_method: "manual",
      automatic_payment_methods: { enabled: true },
    });

    // 2️⃣ Store PaymentIntent ID on order
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        stripe_payment_intent_id: intent.id,
        payment_status: "authorized",
      })
      .eq("id", orderId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // 3️⃣ Return clientSecret to frontend
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
