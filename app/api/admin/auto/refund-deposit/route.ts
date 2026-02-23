// app/api/admin/auto/refund-deposit/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const stripe = new Stripe(env("STRIPE_SECRET_KEY"));

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // User-scoped client to validate admin role
    const supabaseUser = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      }
    );

    const { data: u, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !u?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: prof, error: profErr } = await supabaseUser
      .from("profiles")
      .select("role")
      .eq("id", u.user.id)
      .maybeSingle();

    if (profErr) {
      return NextResponse.json({ error: `Failed to check role: ${profErr.message}` }, { status: 500 });
    }

    if (prof?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "");
    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    // Service role for protected reads/writes
    const admin = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { data: rental, error } = await admin
      .from("rentals")
      .select(`
        id,
        paid,
        return_confirmed_at,
        deposit_cents,
        stripe_payment_intent_id,
        deposit_refund_status,
        deposit_refund_amount_cents
      `)
      .eq("id", rentalId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Failed to load rental: ${error.message}` },
        { status: 500 }
      );
    }

    if (!rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (!rental.paid) {
      return NextResponse.json({ error: "Cannot refund deposit: rental not marked paid." }, { status: 400 });
    }

    if (!rental.return_confirmed_at) {
      return NextResponse.json({ error: "Cannot refund deposit: return not confirmed." }, { status: 400 });
    }

    if (rental.deposit_refund_status === "refunded") {
      return NextResponse.json({ ok: true, note: "Already refunded" });
    }

    if (rental.deposit_refund_status === "withheld") {
      return NextResponse.json(
        { error: "Deposit is already marked withheld. Clear/update decision before refunding." },
        { status: 400 }
      );
    }

    const depositCents = Number(rental.deposit_cents || 0);

    // If no deposit exists, finalize as n/a and don't error
    if (!Number.isFinite(depositCents) || depositCents <= 0) {
      const { error: noDepErr } = await admin
        .from("rentals")
        .update({ deposit_refund_status: "n/a", deposit_refund_amount_cents: 0 })
        .eq("id", rentalId);

      if (noDepErr) {
        return NextResponse.json(
          { error: `No deposit found, but failed to update rental: ${noDepErr.message}` },
          { status: 500 }
        );
      }

      await admin.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: u.user.id,
        actor_role: "admin",
        event_type: "deposit_refund_skipped",
        event_payload: { reason: "no_deposit_cents" },
      });

      return NextResponse.json({ ok: true, note: "No deposit to refund" });
    }

    const pi = String(rental.stripe_payment_intent_id || "").trim();
    if (!pi) {
      return NextResponse.json(
        { error: "Missing Stripe payment_intent on rental (stripe_payment_intent_id)." },
        { status: 400 }
      );
    }

    // Refund only the deposit portion
    try {
      await stripe.refunds.create({
        payment_intent: pi,
        amount: depositCents,
      });
    } catch (stripeErr: any) {
      return NextResponse.json(
        { error: `Stripe refund failed: ${stripeErr?.message || "Unknown Stripe error"}` },
        { status: 500 }
      );
    }

    const { error: updErr } = await admin
      .from("rentals")
      .update({
        deposit_refund_status: "refunded",
        deposit_refund_amount_cents: depositCents,
      })
      .eq("id", rentalId);

    if (updErr) {
      return NextResponse.json(
        { error: `Stripe refunded, but failed to update rental status: ${updErr.message}` },
        { status: 500 }
      );
    }

    await admin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: u.user.id,
      actor_role: "admin",
      event_type: "deposit_refunded",
      event_payload: { amount_cents: depositCents },
    });

    return NextResponse.json({ ok: true, amountCents: depositCents });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}