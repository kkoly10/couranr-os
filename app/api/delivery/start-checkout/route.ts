import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await supabaseAdmin.auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      pickupAddress,
      dropoffAddress,
      miles,
      weight,
      stops,
      rush,
      signature,
      totalCents,
    } = body;

    if (!pickupAddress || !dropoffAddress) {
      return NextResponse.json(
        { error: "Missing addresses" },
        { status: 400 }
      );
    }

    // 1️⃣ create order
    const { data: order } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_id: user.id,
        total_cents: totalCents,
        service_type: "delivery",
        status: "pending",
      })
      .select()
      .single();

    // 2️⃣ create addresses
    const { data: pickup } = await supabaseAdmin
      .from("addresses")
      .insert({ address_line: pickupAddress })
      .select()
      .single();

    const { data: dropoff } = await supabaseAdmin
      .from("addresses")
      .insert({ address_line: dropoffAddress })
      .select()
      .single();

    // 3️⃣ create delivery
    await supabaseAdmin.from("deliveries").insert({
      order_id: order.id,
      pickup_address_id: pickup.id,
      dropoff_address_id: dropoff.id,
      estimated_miles: miles,
      weight_lbs: weight,
      stops,
      rush,
      signature_required: signature,
      status: "created",
    });

    // 4️⃣ stripe checkout
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/courier/confirmation?order=${order.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/courier/checkout`,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: totalCents,
            product_data: {
              name: "Couranr Delivery",
            },
          },
          quantity: 1,
        },
      ],
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message || "Checkout failed" },
      { status: 500 }
    );
  }
}