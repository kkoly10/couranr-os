import { NextResponse } from "next/server";

import { stripe } from "../../../lib/stripe";

export async function POST(req: Request) {

  try {

    const body = await req.json();

    const { amountCents, currency = "usd", metadata } = body || {};

    if (!amountCents || typeof amountCents !== "number" || amountCents < 50) {

      return NextResponse.json(

        { error: "Invalid amountCents" },

        { status: 400 }

      );

    }

    // Manual capture = authorize now, capture later after delivery

    const intent = await stripe.paymentIntents.create({

      amount: amountCents,

      currency,

      capture_method: "manual",

      automatic_payment_methods: { enabled: true },

      metadata: metadata || {}

    });

    return NextResponse.json({

      clientSecret: intent.client_secret,

      paymentIntentId: intent.id

    });

  } catch (err: any) {

    return NextResponse.json(

      { error: err?.message || "Failed to create payment intent" },

      { status: 500 }

    );

  }

}
Home
 
