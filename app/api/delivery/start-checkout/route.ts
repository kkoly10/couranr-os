// app/api/delivery/start-checkout/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";
import { createDeliveryOrderFlow } from "@/lib/delivery/createDeliveryOrderFlow";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  // Keep whatever your stripe package expects (you previously needed 2024-04-10)
  apiVersion: "2024-04-10",
});

function getBaseUrl(req: Request) {
  // Prefer origin (works on Vercel)
  const origin = req.headers.get("origin");
  if (origin && origin.startsWith("http")) return origin;

  // Fallback: x-forwarded-proto + host
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto}://${host}`;

  // Last resort: env (must include https)
  const envUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (envUrl && envUrl.startsWith("http")) return envUrl;

  // If we get here, we cannot safely construct URLs
  throw new Error("Base URL could not be determined.");
}

export async function POST(req: Request) {
  try {
    // 1) Auth
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : "";

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = userRes.user;

    // 2) Parse input
    const body = await req.json();

    const pickupAddressLine = body?.pickupAddress?.address_line || "";
    const dropoffAddressLine = body?.dropoffAddress?.address_line || "";

    const estimatedMiles = Number(body?.estimatedMiles ?? 0);
    const weightLbs = Number(body?.weightLbs ?? 0);
    const stops = Number(body?.stops ?? 0);

    const rush = !!body?.rush;
    const signatureRequired = !!body?.signatureRequired;
    const scheduledAt = body?.scheduledAt ?? null;

    if (!pickupAddressLine || !dropoffAddressLine) {
      return NextResponse.json({ error: "Pickup and drop-off are required." }, { status: 400 });
    }

    // 3) Server pricing (source of truth)
    const pricing = computeDeliveryPrice({
      miles: estimatedMiles,
      weightLbs,
      stops,
      rush,
      signature: signatureRequired,
    });

    const amountCents = pricing.amountCents;

    // 4) Create DB records (order + delivery)
    // IMPORTANT: createDeliveryOrderFlow must match your current DB columns.
    const { orderId, orderNumber } = await createDeliveryOrderFlow({
      customerId: user.id,
      pickupAddress: { address_line: pickupAddressLine },
      dropoffAddress: { address_line: dropoffAddressLine },
      estimatedMiles,
      weightLbs,
      rush,
      signatureRequired,
      stops,
      scheduledAt,
      totalCents: amountCents,
    } as any);

    // 5) Stripe checkout session
    const baseUrl = getBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Couranr Delivery",
              description: orderNumber ? `Order #${orderNumber}` : undefined,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      // Link Stripe session to your order
      client_reference_id: orderId,
      metadata: {
        orderId,
        orderNumber: orderNumber || "",
        service: "delivery",
      },

      success_url: `${baseUrl}/courier/confirmation?orderId=${encodeURIComponent(
        orderId
      )}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/courier/checkout?canceled=1`,
    });

    return NextResponse.json({
      url: session.url,
      orderId,
      orderNumber,
      amountCents,
    });
  } catch (err: any) {
    console.error("start-checkout error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to start checkout" },
      { status: 500 }
    );
  }
}