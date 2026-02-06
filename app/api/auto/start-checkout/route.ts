// app/api/auto/start-checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function siteUrlFromReq(req: NextRequest) {
  // Works on Vercel + local
  const origin = req.headers.get("origin");
  if (origin) return origin;

  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "www.couranr.com";

  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host.startsWith("http")) return host;
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "").trim();

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // ✅ IMPORTANT: renter pays, so gate by renter_id (not user_id)
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        renter_id,
        user_id,
        status,
        rate_cents,
        deposit_cents,
        docs_complete,
        agreement_signed,
        paid,
        paid_at,
        stripe_checkout_session_id,
        vehicles:vehicles(id, year, make, model)
      `
      )
      .eq("id", rentalId)
      .eq("renter_id", user.id)
      .single();

    if (rErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (!rental.docs_complete) {
      return NextResponse.json({ error: "Verification not complete" }, { status: 409 });
    }
    if (!rental.agreement_signed) {
      return NextResponse.json({ error: "Agreement not signed" }, { status: 409 });
    }
    if (rental.paid || rental.paid_at) {
      return NextResponse.json(
        { ok: true, alreadyPaid: true, checkoutSessionId: rental.stripe_checkout_session_id || null },
        { status: 200 }
      );
    }

    const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2024-06-20",
    });

    const siteUrl = siteUrlFromReq(req);
    const successUrl = `${siteUrl}/auto/checkout/success?rentalId=${encodeURIComponent(rentalId)}`;
    const cancelUrl = `${siteUrl}/auto/checkout?rentalId=${encodeURIComponent(rentalId)}&canceled=1`;

    // Build a nice label
    const v: any = Array.isArray(rental.vehicles) ? rental.vehicles[0] : rental.vehicles;
    const carLabel =
      v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "Couranr Auto Rental";

    const rate = Number(rental.rate_cents || 0);
    if (!Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: "Invalid rate_cents on rental" }, { status: 400 });
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: rate,
          product_data: { name: `Rental Payment — ${carLabel}` },
        },
      },
    ];

    const deposit = Number(rental.deposit_cents || 0);
    if (Number.isFinite(deposit) && deposit > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: deposit,
          product_data: { name: "Security Deposit (Refundable)" },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        rentalId,
        renterId: user.id,
        ownerId: rental.user_id,
      },
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe session created but URL missing" }, { status: 500 });
    }

    await supabaseAdmin
      .from("rentals")
      .update({
        stripe_checkout_session_id: session.id,
        // Optional: move out of draft once checkout begins
        status: rental.status === "draft" ? "pending_payment" : rental.status,
      })
      .eq("id", rentalId);

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}