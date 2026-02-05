// app/api/auto/start-checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function asSingle<T>(v: any): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "").trim();

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    // Load rental (owner only)
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        status,
        rate_cents,
        deposit_cents,
        pricing_mode,
        start_date,
        end_date,
        paid,
        paid_at,
        stripe_checkout_session_id,
        vehicles:vehicles(id, year, make, model)
      `
      )
      .eq("id", rentalId)
      .eq("user_id", user.id)
      .single();

    if (error || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // If already paid or already has checkout session, just return it
    if (rental.paid || rental.paid_at) {
      return NextResponse.json(
        { ok: true, alreadyPaid: true, checkoutSessionId: rental.stripe_checkout_session_id || null },
        { status: 200 }
      );
    }

    const v = asSingle<{ year?: any; make?: any; model?: any }>(rental.vehicles);
    const carLabel = v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "Your rental vehicle";

    // NOTE:
    // This route should only “start checkout” in YOUR system (or return data needed to create Stripe session).
    // If you already have /api/auto/create-checkout-session handling Stripe, keep using that.
    // Here we simply return a consistent payload.

    return NextResponse.json(
      {
        ok: true,
        rentalId: rental.id,
        car: carLabel,
        pricing: {
          pricing_mode: rental.pricing_mode,
          rate_cents: rental.rate_cents,
          deposit_cents: rental.deposit_cents,
          start_date: rental.start_date,
          end_date: rental.end_date,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}