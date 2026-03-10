export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe not configured");
  return new Stripe(key);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();
    const stripe = getStripe();

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "").trim();
    const sessionId = String(body?.sessionId || "").trim();

    if (!rentalId || !sessionId) {
      return NextResponse.json(
        { error: "Missing rentalId or sessionId" },
        { status: 400 }
      );
    }

    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select(
        "id,user_id,renter_id,paid,status,stripe_checkout_session_id,stripe_payment_intent_id,verification_status,agreement_signed,docs_complete,lockbox_code_released_at"
      )
      .eq("id", rentalId)
      .maybeSingle();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    const ownerId = String(rental.user_id || rental.renter_id || "").trim();
    if (ownerId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Payment not confirmed yet" },
        { status: 400 }
      );
    }

    const metaRentalId = String(
      session.metadata?.rentalId || session.metadata?.rental_id || ""
    ).trim();

    if (metaRentalId !== rentalId) {
      return NextResponse.json(
        { error: "Session does not match rental" },
        { status: 400 }
      );
    }

    if (
      rental.stripe_checkout_session_id &&
      rental.stripe_checkout_session_id !== session.id
    ) {
      return NextResponse.json(
        { error: "Session does not match latest checkout" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const verificationApproved =
      String(rental.verification_status || "").toLowerCase() === "approved";
    const agreementSigned = !!rental.agreement_signed;
    const docsComplete = !!rental.docs_complete;
    const lockboxReleased = !!rental.lockbox_code_released_at;

    let nextStatus = "paid_pending_review";
    if (verificationApproved && agreementSigned && docsComplete && lockboxReleased) {
      nextStatus = "pickup_ready";
    }

    const { error: updErr } = await supabase
      .from("rentals")
      .update({
        paid: true,
        paid_at: now,
        status: nextStatus,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : rental.stripe_payment_intent_id ?? null,
      })
      .eq("id", rentalId)
      .or(`user_id.eq.${user.id},renter_id.eq.${user.id}`);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "checkout_confirmed",
      event_payload: {
        source: "checkout_success_confirm",
        session_id: session.id,
        payment_intent:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
        amount_total: session.amount_total,
        currency: session.currency,
        status_after: nextStatus,
      },
    });

    return NextResponse.json({
      ok: true,
      paid: true,
      status: nextStatus,
    });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const status = msg === "Stripe not configured" ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}