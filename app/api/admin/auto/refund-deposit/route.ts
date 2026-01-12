import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

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

    const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: prof } = await supabase.from("profiles").select("role").eq("id", u.user.id).single();
    if (prof?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body.rentalId || "");
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    // Use service role to read safely
    const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    const { data: rental, error } = await admin
      .from("rentals")
      .select("id, deposit_cents, stripe_payment_intent_id, deposit_refund_status")
      .eq("id", rentalId)
      .single();

    if (error || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    const depositCents = Number(rental.deposit_cents || 0);
    if (depositCents <= 0) {
      await admin.from("rentals").update({ deposit_refund_status: "n/a" }).eq("id", rentalId);
      return NextResponse.json({ ok: true, note: "No deposit to refund" });
    }

    if (rental.deposit_refund_status === "refunded") {
      return NextResponse.json({ ok: true, note: "Already refunded" });
    }

    const pi = String(rental.stripe_payment_intent_id || "");
    if (!pi) return NextResponse.json({ error: "Missing Stripe payment_intent" }, { status: 400 });

    // Refund only the deposit portion
    await stripe.refunds.create({
      payment_intent: pi,
      amount: depositCents,
    });

    await admin
      .from("rentals")
      .update({ deposit_refund_status: "refunded", deposit_refund_amount_cents: depositCents })
      .eq("id", rentalId);

    await admin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: u.user.id,
      actor_role: "admin",
      event_type: "deposit_refunded",
      event_payload: { amount_cents: depositCents },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}