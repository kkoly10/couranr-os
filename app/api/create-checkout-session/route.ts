// app/api/create-checkout-session/route.ts

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-04-10",
});

export async function POST(req: Request) {
  try {
    // 1) Auth
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(
      token
    );

    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2) Read delivery inputs (server will compute amount)
    const body = await req.json();
    const miles = Number(body?.miles);
    const weightLbs = Number(body?.weightLbs);
    const stops = Number(body?.stops ?? 0);
    const rush = !!body?.rush;
    const signature = !!body?.signature;

    const { amountCents } = computeDeliveryPrice({
      miles,
      weightLbs,
      stops,
      rush,
      signature,
    });

    // 3) Create Stripe Checkout session
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Missing NEXT_PUBLIC_BASE_URL" },
        { status: 500 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name: "Couranr Delivery" },
          },
        },
      ],
      // For now, we keep it simple (payment captured immediately).
      // We'll connect "create order" after payment in the next step.
      success_url: `${baseUrl}/courier/confirmation`,
      cancel_url: `${baseUrl}/courier/checkout`,
      metadata: {
        user_id: userRes.user.id,
        miles: String(miles),
        weight_lbs: String(weightLbs),
        stops: String(stops),
        rush: String(rush),
        signature: String(signature),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
