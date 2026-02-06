// app/api/auto/start-checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const stripe = new Stripe(env("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20",
});

function getSiteUrl(req: NextRequest) {
  // Prefer explicit env (best for prod)
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  // Fallback to request origin (works on preview)
  const origin = req.headers.get("origin") || "";
  return origin.replace(/\/$/, "");
}

const supabaseAdmin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "").trim();

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    // Load rental
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        renter_id,
        user_id,
        status,
        purpose,
        pricing_mode,
        rate_cents,
        deposit_cents,
        start_date,
        end_date,
        pickup_at,
        pickup_location,
        docs_complete,
        agreement_signed,
        paid,
        paid_at,
        stripe_checkout_session_id,
        vehicles:vehicles ( year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Ownership gate: renter OR owner (owner allowed for testing/admin)
    const allowed = rental.renter_id === user.id || rental.user_id === user.id;
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // If already paid, no need to start checkout
    if (rental.paid || rental.paid_at) {
      return NextResponse.json({ ok: true, alreadyPaid: true }, { status: 200 });
    }

    // Require verification docs + agreement before payment
    if (!rental.docs_complete) {
      return NextResponse.json({ error: "Verification required before payment." }, { status: 409 });
    }
    if (!rental.agreement_signed) {
      return NextResponse.json({ error: "Agreement must be signed before payment." }, { status: 409 });
    }

    const siteUrl = getSiteUrl(req);

    const v = Array.isArray(rental.vehicles) ? rental.vehicles[0] : rental.vehicles;
    const carLabel =
      v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "Couranr Auto Rental";

    const rateCents = Number(rental.rate_cents || 0);
    const depositCents = Number(rental.deposit_cents || 0);

    if (!Number.isFinite(rateCents) || rateCents < 50) {
      return NextResponse.json({ error: "Invalid rental rate." }, { status: 400 });
    }
    if (!Number.isFinite(depositCents) || depositCents < 0) {
      return NextResponse.json({ error: "Invalid deposit amount." }, { status: 400 });
    }

    // If we already created a Checkout session earlier, try to reuse it (and return url)
    if (rental.stripe_checkout_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(rental.stripe_checkout_session_id);
        if (existing?.url) {
          return NextResponse.json({ ok: true, url: existing.url }, { status: 200 });
        }
        // If no url (rare), fall through and create a new one
      } catch {
        // If Stripe can't retrieve it, fall through and create new
      }
    }

    // Build line items
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${carLabel} — Rental`,
          },
          unit_amount: rateCents,
        },
        quantity: 1,
      },
    ];

    if (depositCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: `${carLabel} — Security Deposit`,
          },
          unit_amount: depositCents,
        },
        quantity: 1,
      });
    }

    const successUrl = `${siteUrl}/dashboard/auto?paid=1&rentalId=${encodeURIComponent(
      rentalId
    )}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${siteUrl}/auto/checkout?rentalId=${encodeURIComponent(rentalId)}&canceled=1`;

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,

      // Useful for webhook + audit
      metadata: {
        rentalId: rentalId,
        renterId: String(rental.renter_id || ""),
        ownerId: String(rental.user_id || ""),
        purpose: String(rental.purpose || ""),
      },

      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe session created but URL missing." }, { status: 500 });
    }

    // Save session id on rental (so webhook + reuse works)
    await supabaseAdmin
      .from("rentals")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", rentalId);

    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: rental.renter_id === user.id ? "renter" : "owner",
      event_type: "checkout_started",
      event_payload: { session_id: session.id },
    });

    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}