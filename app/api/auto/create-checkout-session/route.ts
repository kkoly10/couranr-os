import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// ✅ Stripe init — FIXED (Option A: no apiVersion)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Supabase (server-side)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      rentalId,
      amountCents,
      customerEmail,
      successUrl,
      cancelUrl,
    } = body;

    if (!rentalId || !amountCents || !successUrl || !cancelUrl) {
      return NextResponse.json(
        { error: "Missing required checkout fields" },
        { status: 400 }
      );
    }

    // 1️⃣ Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customerEmail || undefined,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Couranr Auto Rental",
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: {
        rental_id: rentalId,
      },
    });

    // 2️⃣ Store Stripe session on rental record
    const { error: updateErr } = await supabase
      .from("rentals")
      .update({
        stripe_checkout_session_id: session.id,
        status: "awaiting_payment",
      })
      .eq("id", rentalId);

    if (updateErr) {
      return NextResponse.json(
        { error: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      checkoutUrl: session.url,
    });
  } catch (err: any) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}