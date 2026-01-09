import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body.rentalId || "");
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    const { data: rental, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        status,
        rate_cents,
        deposit_cents,
        pricing_mode,
        purpose,
        docs_complete,
        condition_photos_complete,
        agreement_signed,
        vehicles ( year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (error || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    // Gate: must be ready
    if (!rental.docs_complete || !rental.condition_photos_complete || !rental.agreement_signed) {
      return NextResponse.json(
        { error: "Complete uploads and sign agreement before payment." },
        { status: 400 }
      );
    }

    const v: any = rental.vehicles;
    const carTitle = `${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim() || "Couranr Auto Rental";

    const amountCents = Number(rental.rate_cents || 0);
    const depositCents = Number(rental.deposit_cents || 0);

    if (!Number.isFinite(amountCents) || amountCents < 50) {
      return NextResponse.json({ error: "Invalid rental amount" }, { status: 400 });
    }

    // Create Stripe Checkout
    const origin = req.headers.get("origin") || requireEnv("NEXT_PUBLIC_SITE_URL");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${origin}/auto/confirmation?rentalId=${encodeURIComponent(rentalId)}&paid=1`,
      cancel_url: `${origin}/auto/confirmation?rentalId=${encodeURIComponent(rentalId)}`,
      metadata: {
        rentalId,
        purpose: rental.purpose,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: {
              name: carTitle,
              description: rental.pricing_mode === "weekly" ? "Weekly rental" : "Daily rental",
            },
            unit_amount: amountCents,
          },
        },
        ...(depositCents > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: "Security deposit",
                    description: "Refundable deposit (subject to agreement)",
                  },
                  unit_amount: depositCents,
                },
              },
            ]
          : []),
      ],
    });

    // store session id on rental
    await supabase
      .from("rentals")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", rentalId);

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}