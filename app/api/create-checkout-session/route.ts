import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      amountCents,
      pickup,
      dropoff,
      miles,
      weight,
      stops,
      rush,
      signature,
    } = body;

    if (!amountCents || amountCents < 50) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Couranr Delivery",
              description: "Local courier delivery service",
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],

      metadata: {
        pickup: pickup ?? "",
        dropoff: dropoff ?? "",
        miles: miles?.toString() ?? "0",
        weight: weight?.toString() ?? "0",
        stops: stops?.toString() ?? "0",
        rush: rush ? "yes" : "no",
        signature: signature ? "yes" : "no",
      },

      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/confirmation`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/checkout`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json(
      { error: err.message || "Stripe checkout failed" },
      { status: 500 }
    );
  }
}
