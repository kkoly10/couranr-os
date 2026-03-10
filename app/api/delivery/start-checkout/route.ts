import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getUserFromRequest } from "@/app/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createDeliveryOrderFlow } from "@/lib/delivery/createDeliveryOrderFlow";
import { ensureBusinessAccess, parseBusinessAccountId } from "@/lib/businessAccount";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";
import {
  applyBusinessDeliveryPricing,
  getBusinessPricingProfile,
} from "@/lib/businessPricing";
import { DELIVERY_INSTANT_QUOTE_MAX_MILES } from "@/lib/delivery/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

type StartCheckoutBody = {
  pickupAddress?: { address_line?: string };
  dropoffAddress?: { address_line?: string };
  estimatedMiles?: number;
  weightLbs?: number;
  rush?: boolean;
  signatureRequired?: boolean;
  stops?: number;
  scheduledAt?: string | null;
  totalCents?: number;

  recipientName?: string;
  recipientPhone?: string;
  deliveryNotes?: string | null;
  businessAccountId?: string | null;
};

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function siteUrlFromReq(req: NextRequest) {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const origin = req.headers.get("origin") || "";
  if (origin) return origin.replace(/\/$/, "");

  const host = req.headers.get("host") || "";
  if (host) return `https://${host}`.replace(/\/$/, "");

  return "https://www.couranr.com";
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function getDrivingMiles(pickup: string, dropoff: string) {
  const key =
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!key) {
    throw new Error(
      "Google Maps API key is not configured for server-side route validation"
    );
  }

  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json" +
    `?origins=${encodeURIComponent(pickup)}` +
    `&destinations=${encodeURIComponent(dropoff)}` +
    "&mode=driving&units=imperial" +
    `&key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to validate delivery route");
  }

  const json: any = await res.json().catch(() => null);
  if (!json || json.status !== "OK") {
    throw new Error("Unable to validate pickup/drop-off route");
  }

  const el = json?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== "OK" || typeof el?.distance?.value !== "number") {
    throw new Error("Invalid pickup or drop-off address");
  }

  return round2(el.distance.value / 1609.344);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as StartCheckoutBody;

    const pickupLine = String(body?.pickupAddress?.address_line || "").trim();
    const dropoffLine = String(body?.dropoffAddress?.address_line || "").trim();

    if (!pickupLine || !dropoffLine) {
      return NextResponse.json({ error: "Missing addresses" }, { status: 400 });
    }

    const recipientName = String(body?.recipientName || "").trim();
    const recipientPhone = String(body?.recipientPhone || "").trim();

    if (!recipientName) {
      return NextResponse.json(
        { error: "Recipient name is required" },
        { status: 400 }
      );
    }

    if (!recipientPhone || recipientPhone.replace(/\D/g, "").length < 10) {
      return NextResponse.json(
        { error: "Recipient phone is required" },
        { status: 400 }
      );
    }

    const weightLbs = Number(body?.weightLbs || 0);
    const stops = Math.max(0, Math.floor(Number(body?.stops || 0)));
    const rush = !!body?.rush;
    const signatureRequired = !!body?.signatureRequired;

    const validatedMiles = await getDrivingMiles(pickupLine, dropoffLine);

    if (validatedMiles > DELIVERY_INSTANT_QUOTE_MAX_MILES) {
      return NextResponse.json(
        {
          error: `This route is outside the current self-serve service area. Max instant quote distance is ${DELIVERY_INSTANT_QUOTE_MAX_MILES} miles.`,
        },
        { status: 400 }
      );
    }

    const basePrice = computeDeliveryPrice({
      miles: validatedMiles,
      weightLbs,
      stops,
      rush,
      signature: signatureRequired,
    });

    const requestedBusinessAccountId = parseBusinessAccountId(
      body?.businessAccountId
    );

    if (body?.businessAccountId && !requestedBusinessAccountId) {
      return NextResponse.json(
        { error: "Invalid businessAccountId" },
        { status: 400 }
      );
    }

    let totalCents = basePrice.amountCents;
    let pricingStrategy = "base";

    if (requestedBusinessAccountId) {
      const access = await ensureBusinessAccess(
        supabaseAdmin as any,
        user.id,
        requestedBusinessAccountId
      );

      if (!access.ok) {
        return NextResponse.json(
          { error: access.error },
          { status: access.code }
        );
      }

      const profile = await getBusinessPricingProfile(
        supabaseAdmin as any,
        requestedBusinessAccountId
      );
      const adjusted = applyBusinessDeliveryPricing(
        basePrice.amountCents,
        profile
      );
      totalCents = adjusted.amountCents;
      pricingStrategy = adjusted.strategy;
    }

    const created = await createDeliveryOrderFlow({
      customerId: user.id,
      pickupAddress: { address_line: pickupLine },
      dropoffAddress: { address_line: dropoffLine },
      estimatedMiles: validatedMiles,
      weightLbs,
      rush,
      signatureRequired,
      stops,
      scheduledAt: body?.scheduledAt ?? null,
      totalCents,
      recipientName,
      recipientPhone,
      deliveryNotes: body?.deliveryNotes ?? null,
      businessAccountId: requestedBusinessAccountId,
    });

    const { orderId, orderNumber, deliveryId } = created;
    const origin = siteUrlFromReq(req);

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
        serviceType: "delivery",
        orderId,
        deliveryId,
        orderNumber,
        customerId: user.id,
        businessAccountId: requestedBusinessAccountId || "",
      },
      success_url: `${origin}/courier/confirmation?orderId=${encodeURIComponent(
        orderId
      )}&deliveryId=${encodeURIComponent(
        deliveryId
      )}&orderNumber=${encodeURIComponent(
        orderNumber
      )}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/courier/checkout?canceled=1`,
    });

    if (!session.url) {
      throw new Error("Failed to create checkout session");
    }

    return NextResponse.json({
      ok: true,
      url: session.url,
      orderId,
      orderNumber,
      deliveryId,
      pricing: {
        mode: requestedBusinessAccountId ? "business" : "personal",
        strategy: pricingStrategy,
        validatedMiles,
        baseAmountCents: basePrice.amountCents,
        chargedAmountCents: totalCents,
        breakdown: basePrice.breakdown,
      },
    });
  } catch (err: any) {
    console.error("delivery start-checkout error:", err);
    const msg = err?.message || "Server error";

    if (
      msg.includes("outside the current self-serve service area") ||
      msg.includes("Recipient") ||
      msg.includes("Invalid pickup") ||
      msg.includes("Invalid businessAccountId") ||
      msg.includes("Items over") ||
      msg.includes("Weight must be") ||
      msg.includes("Miles must be")
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}