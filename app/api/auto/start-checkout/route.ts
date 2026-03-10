import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

const supabaseAdmin = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: { persistSession: false },
  }
);

const stripe = new Stripe(env("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-04-10",
});

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "").trim();

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(
        `
          id,
          renter_id,
          user_id,
          status,
          pricing_mode,
          rate_cents,
          deposit_cents,
          paid,
          stripe_checkout_session_id,
          vehicles:vehicles(id, year, make, model)
        `
      )
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    const ownerId = String(rental.renter_id || rental.user_id || "").trim();
    if (!ownerId || ownerId !== user.id) {
      return NextResponse.json(
        { error: "Forbidden - this rental does not belong to your account" },
        { status: 403 }
      );
    }

    if (rental.paid) {
      return NextResponse.json(
        { ok: true, alreadyPaid: true },
        { status: 200 }
      );
    }

    const blockedStatuses = new Set(["cancelled", "completed", "closed"]);
    if (blockedStatuses.has(String(rental.status || "").toLowerCase())) {
      return NextResponse.json(
        { error: "This rental is not eligible for checkout" },
        { status: 400 }
      );
    }

    const rateCents = Number(rental.rate_cents || 0);
    const depositCents = Number(rental.deposit_cents || 0);

    if (rateCents <= 0 && depositCents <= 0) {
      return NextResponse.json(
        { error: "Rental pricing is missing" },
        { status: 400 }
      );
    }

    const siteUrl = siteUrlFromReq(req);
    const v: any = Array.isArray(rental.vehicles)
      ? rental.vehicles[0]
      : rental.vehicles;

    const carLabel =
      v?.year && v?.make && v?.model
        ? `${v.year} ${v.make} ${v.model}`
        : "Couranr Auto rental";

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    if (rateCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: rateCents,
          product_data: {
            name: `${carLabel} (${String(
              rental.pricing_mode || "rental"
            ).toUpperCase()})`,
          },
        },
      });
    }

    if (depositCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: depositCents,
          product_data: {
            name: "Security deposit",
          },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: user.id,
      line_items: lineItems,
      metadata: {
        serviceType: "auto",
        rentalId: rental.id,
        rental_id: rental.id,
        customerId: user.id,
      },
      success_url: `${siteUrl}/auto/checkout/success?rentalId=${encodeURIComponent(
        rental.id
      )}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/auto/checkout?rentalId=${encodeURIComponent(
        rental.id
      )}`,
    });

    await supabaseAdmin
      .from("rentals")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", rental.id)
      .eq("renter_id", user.id);

    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}