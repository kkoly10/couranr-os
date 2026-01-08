import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createDeliveryOrderFlow } from "@/lib/delivery/createDeliveryOrderFlow";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

type StartCheckoutBody = {
  pickupAddress: { address_line: string };
  dropoffAddress: { address_line: string };
  estimatedMiles: number;
  weightLbs: number;
  rush: boolean;
  signatureRequired: boolean;
  stops: number;
  scheduledAt: string | null;
  totalCents: number;

  // NEW
  recipientName: string;
  recipientPhone: string;
  deliveryNotes: string | null;
};

export async function POST(req: Request) {
  try {
    // 1) Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace("Bearer ", "").trim();

    const {
      data: { user },
      error: userErr,
    } = await supabaseAdmin.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2) Parse body
    const body = (await req.json()) as StartCheckoutBody;

    const pickupLine = body?.pickupAddress?.address_line?.trim();
    const dropoffLine = body?.dropoffAddress?.address_line?.trim();

    if (!pickupLine || !dropoffLine) {
      return NextResponse.json({ error: "Missing addresses" }, { status: 400 });
    }

    const recipientName = (body?.recipientName || "").trim();
    const recipientPhone = (body?.recipientPhone || "").trim();

    if (!recipientName) {
      return NextResponse.json({ error: "Recipient name is required" }, { status: 400 });
    }
    if (!recipientPhone || recipientPhone.length < 10) {
      return NextResponse.json({ error: "Recipient phone is required" }, { status: 400 });
    }

    const totalCents = Number(body?.totalCents);
    if (!Number.isFinite(totalCents) || totalCents < 50) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    // 3) Create order + delivery (DB)
    // createDeliveryOrderFlow should create:
    // - orders row linked to customerId
    // - deliveries row linked to order_id and addresses
    const created = await createDeliveryOrderFlow({
      customerId: user.id,
      pickupAddress: { address_line: pickupLine },
      dropoffAddress: { address_line: dropoffLine },
      estimatedMiles: Number(body?.estimatedMiles) || 0,
      weightLbs: Number(body?.weightLbs) || 0,
      rush: !!body?.rush,
      signatureRequired: !!body?.signatureRequired,
      stops: Math.max(0, Math.floor(Number(body?.stops) || 0)),
      scheduledAt: body?.scheduledAt ?? null,
      totalCents,

      // NEW (your createDeliveryOrderFlow must write these into deliveries)
      recipientName,
      recipientPhone,
      deliveryNotes: body?.deliveryNotes ?? null,
    } as any);

    const { orderId, orderNumber, deliveryId } = created;

    // 4) Create Stripe Checkout Session
    const origin =
      req.headers.get("origin") ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://example.com";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: totalCents,
            product_data: {
              name: "Couranr Delivery",
              description: `Order #${orderNumber}`,
            },
          },
        },
      ],
      metadata: {
        orderId,
        deliveryId,
        orderNumber,
        customerId: user.id,
      },
      success_url: `${origin}/courier/confirmation?orderId=${encodeURIComponent(
        orderId
      )}&deliveryId=${encodeURIComponent(deliveryId)}&orderNumber=${encodeURIComponent(
        orderNumber
      )}`,
      cancel_url: `${origin}/courier/checkout?canceled=1`,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    return NextResponse.json({
      url: session.url,
      orderId,
      orderNumber,
      deliveryId,
    });
  } catch (err: any) {
    console.error("start-checkout error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}