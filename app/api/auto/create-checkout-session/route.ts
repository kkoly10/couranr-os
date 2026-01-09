import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = auth.replace("Bearer ", "");

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    // 1️⃣ Get user
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2️⃣ Parse body
    const body = await req.json();
    const { rentalId } = body;

    if (!rentalId) {
      return NextResponse.json(
        { error: "Missing rentalId" },
        { status: 400 }
      );
    }

    // 3️⃣ Load rental
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select(
        `
        id,
        rate_cents,
        deposit_cents,
        vehicles (
          year,
          make,
          model
        )
      `
      )
      .eq("id", rentalId)
      .eq("user_id", user.id)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json(
        { error: "Rental not found" },
        { status: 404 }
      );
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${rental.vehicles.year} ${rental.vehicles.make} ${rental.vehicles.model}`,
          },
          unit_amount: rental.rate_cents,
        },
        quantity: 1,
      },
    ];

    if (rental.deposit_cents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Refundable Security Deposit",
          },
          unit_amount: rental.deposit_cents,
        },
        quantity: 1,
      });
    }

    // 4️⃣ Create Stripe session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      line_items: lineItems,
      metadata: {
        rentalId: rental.id,
        userId: user.id,
        type: "auto_rental",
      },
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/auto/confirmation?rentalId=${rental.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/auto/vehicles`,
    });

    // 5️⃣ Save Stripe session ID
    await supabase
      .from("rentals")
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq("id", rental.id);

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Auto checkout error:", err);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}