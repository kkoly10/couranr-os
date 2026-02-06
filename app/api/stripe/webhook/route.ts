// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Stripe client
const stripe = new Stripe(env("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20",
});

function getRentalIdFromSession(session: Stripe.Checkout.Session) {
  return String(session.metadata?.rentalId || session.metadata?.rental_id || "").trim();
}

async function markRentalPaid(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  const rentalId = getRentalIdFromSession(session);
  if (!rentalId) return;

  const checkoutSessionId = session.id;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;

  // ✅ Save paid status + ALSO persist checkout session id
  await supabase
    .from("rentals")
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      status: "active",
      stripe_checkout_session_id: checkoutSessionId, // ✅ added
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("id", rentalId);

  // Event log (nice for audit)
  await supabase.from("rental_events").insert({
    rental_id: rentalId,
    actor_role: "system",
    event_type: "payment_completed",
    event_payload: {
      session_id: checkoutSessionId,
      payment_intent_id: paymentIntentId,
      type: session.mode,
    },
  });
}

export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    // IMPORTANT: Stripe needs raw body for signature verification
    const rawBody = await req.text();

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      env("STRIPE_WEBHOOK_SECRET")
    );

    const supabase = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // ✅ Handle both immediate + async success flows
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await markRentalPaid(supabase, session);
    }

    // Optional but helpful for some payment methods
    if (event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      await markRentalPaid(supabase, session);
    }

    // Optional: record failures (helps debugging)
    if (event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const rentalId = getRentalIdFromSession(session);
      if (rentalId) {
        await supabase.from("rental_events").insert({
          rental_id: rentalId,
          actor_role: "system",
          event_type: "payment_failed",
          event_payload: { session_id: session.id },
        });
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Webhook error" },
      { status: 400 }
    );
  }
}