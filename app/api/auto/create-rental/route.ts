// app/api/auto/create-rental/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * AUTO: Create Rental + Stripe Checkout Session (Debug Version)
 *
 * Accepts the payload your UI is currently sending:
 * {
 *   vehicleId: string,
 *   days: number,
 *   pickupAt: string (ISO),
 *   fullName: string,
 *   phone: string,
 *   license: string,
 *   signature: string
 * }
 *
 * Server computes:
 * - pricingMode (daily/weekly)
 * - rateCents (rental total)
 * - startDate/endDate
 * and creates:
 * - renters row (upsert)
 * - rentals row
 * - rental_agreements row
 * - Stripe Checkout session (amount = rate + deposit)
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // ✅ Option A: do NOT set apiVersion to avoid TS literal mismatch build errors
  // apiVersion intentionally omitted
});

function jsonError(
  status: number,
  message: string,
  debug?: Record<string, any>
) {
  return NextResponse.json(
    {
      error: message,
      ...(debug ? { debug } : {}),
    },
    { status }
  );
}

function parseDays(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(1, Math.floor(n));
}

function addDaysISO(dateIso: string, days: number) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  // store date-only for DB columns (date)
  return nd.toISOString().slice(0, 10);
}

function dateOnlyISO(dateIso: string) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    // 1) Auth (Bearer token)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "")
      : "";

    if (!token) {
      return jsonError(401, "Unauthorized (missing Bearer token)");
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    );

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return jsonError(401, "Unauthorized (invalid session)", {
        userErr: userErr?.message || String(userErr),
      });
    }

    // 2) Read body (DEBUG LOG)
    const body = await req.json().catch(() => null);

    console.log("AUTO_CREATE_RENTAL_BODY:", body);

    if (!body || typeof body !== "object") {
      return jsonError(400, "Invalid JSON body", { body });
    }

    const vehicleId = String(body.vehicleId || "");
    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const licenseNumber = String(body.license || "").trim();
    const signature = String(body.signature || "").trim();
    const pickupAt = String(body.pickupAt || "").trim();
    const days = parseDays(body.days);

    // 3) Validate required inputs
    const missing: string[] = [];
    if (!vehicleId) missing.push("vehicleId");
    if (!fullName) missing.push("fullName");
    if (!phone) missing.push("phone");
    if (!licenseNumber) missing.push("license");
    if (!signature) missing.push("signature");
    if (!pickupAt) missing.push("pickupAt");
    if (!days) missing.push("days");

    if (missing.length) {
      return jsonError(400, "Missing required fields", {
        missing,
        received: {
          vehicleId,
          fullName,
          phone,
          license: licenseNumber ? "[present]" : "",
          signature: signature ? "[present]" : "",
          pickupAt,
          days,
        },
      });
    }

    const startDate = dateOnlyISO(pickupAt);
    const endDate = addDaysISO(pickupAt, days);

    if (!startDate || !endDate) {
      return jsonError(400, "Invalid pickupAt date", { pickupAt, startDate, endDate });
    }

    // 4) Fetch vehicle (RLS allows public select on vehicles)
    const { data: vehicle, error: vehicleErr } = await supabase
      .from("vehicles")
      .select(
        "id, year, make, model, trim, daily_rate_cents, weekly_rate_cents, deposit_cents, status"
      )
      .eq("id", vehicleId)
      .single();

    if (vehicleErr || !vehicle) {
      return jsonError(404, "Vehicle not found", {
        vehicleId,
        vehicleErr: vehicleErr?.message || String(vehicleErr),
      });
    }

    if (vehicle.status !== "available") {
      return jsonError(409, "Vehicle not available", {
        vehicleStatus: vehicle.status,
      });
    }

    // 5) Compute pricing server-side (single source of truth)
    // Rules:
    // - Same-day = daily charge
    // - Weekly starts at 7 days
    // - If days >= 7: charge weekly for each 7-day block + daily for remainder
    const daily = Number(vehicle.daily_rate_cents || 0);
    const weekly = Number(vehicle.weekly_rate_cents || 0);
    const deposit = Number(vehicle.deposit_cents || 0);

    if (daily <= 0 && weekly <= 0) {
      return jsonError(500, "Vehicle pricing not configured", {
        daily,
        weekly,
      });
    }

    const weeks = Math.floor(days / 7);
    const remainderDays = days % 7;

    let rentalTotalCents = 0;

    if (days >= 7 && weekly > 0) {
      rentalTotalCents += weeks * weekly;
      if (remainderDays > 0) {
        if (daily <= 0) {
          return jsonError(500, "Daily rate missing for remainder days", {
            daily,
            weekly,
            days,
            weeks,
            remainderDays,
          });
        }
        rentalTotalCents += remainderDays * daily;
      }
    } else {
      if (daily <= 0) {
        return jsonError(500, "Daily rate missing", { daily, weekly });
      }
      rentalTotalCents = days * daily;
    }

    const pricingMode = days >= 7 ? "weekly" : "daily";

    // 6) Upsert renter profile for this user
    // renters has unique(user_id)
    const { data: renterRow, error: renterErr } = await supabase
      .from("renters")
      .upsert(
        {
          user_id: user.id,
          full_name: fullName,
          phone,
          email: user.email || "",
          license_number: licenseNumber,
          // safe defaults (you can expand later)
          license_state: "VA",
          license_expires: "2030-01-01",
        },
        { onConflict: "user_id" }
      )
      .select("id")
      .single();

    if (renterErr || !renterRow) {
      return jsonError(500, "Failed to save renter info", {
        renterErr: renterErr?.message || String(renterErr),
      });
    }

    // 7) Create rental row (status awaiting_payment)
    const pickupLocation =
      "1090 Stafford Marketplace, VA 22556 (9am–6pm)";
    const notes = JSON.stringify({
      pickupAt,
      signatureCaptured: true,
    });

    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .insert({
        renter_id: renterRow.id,
        user_id: user.id,
        vehicle_id: vehicle.id,
        pricing_mode: pricingMode,
        rate_cents: rentalTotalCents,
        deposit_cents: deposit,
        start_date: startDate,
        end_date: endDate,
        status: "awaiting_payment",
        pickup_location: pickupLocation,
        notes,
      })
      .select("id")
      .single();

    if (rentalErr || !rental) {
      return jsonError(500, "Failed to create rental", {
        rentalErr: rentalErr?.message || String(rentalErr),
      });
    }

    // 8) Save agreement signature record (MVP)
    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "";

    const { error: agreementErr } = await supabase
      .from("rental_agreements")
      .insert({
        rental_id: rental.id,
        signed_name: fullName,
        ip_address: ip,
        agreement_version: "v1",
      });

    if (agreementErr) {
      // Don’t block checkout if agreement insert fails, but log it
      console.error("RENTAL_AGREEMENT_INSERT_ERROR:", agreementErr);
    }

    // 9) Stripe checkout session
    // Charge = rentalTotal + deposit (if any)
    const totalChargeCents = rentalTotalCents + deposit;

    if (totalChargeCents < 50) {
      return jsonError(400, "Invalid amount for Stripe", {
        rentalTotalCents,
        deposit,
        totalChargeCents,
      });
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "";

    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
      return jsonError(
        500,
        "Missing NEXT_PUBLIC_BASE_URL (must include https://)",
        { baseUrl }
      );
    }

    const vehicleLabel = `${vehicle.year} ${vehicle.make} ${vehicle.model}${
      vehicle.trim ? " " + vehicle.trim : ""
    }`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Couranr Auto Rental — ${vehicleLabel}`,
              description:
                deposit > 0
                  ? `Rental (${days} day(s)) + refundable deposit`
                  : `Rental (${days} day(s))`,
            },
            unit_amount: totalChargeCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        rentalId: rental.id,
        vehicleId: vehicle.id,
        userId: user.id,
        days: String(days),
        pickupAt,
      },
      success_url: `${baseUrl}/auto/confirmation?rentalId=${encodeURIComponent(
        rental.id
      )}`,
      cancel_url: `${baseUrl}/auto/vehicles`,
    });

    // 10) Persist Stripe IDs
    const { error: stripeSaveErr } = await supabase
      .from("rentals")
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq("id", rental.id);

    if (stripeSaveErr) {
      console.error("RENTAL_STRIPE_SESSION_SAVE_ERROR:", stripeSaveErr);
    }

    return NextResponse.json({
      checkoutUrl: session.url,
      rentalId: rental.id,
      debug: {
        received: {
          vehicleId,
          days,
          pickupAt,
          fullName,
          phone,
          license: "[present]",
          signature: "[present]",
        },
        computed: {
          startDate,
          endDate,
          pricingMode,
          rentalTotalCents,
          depositCents: deposit,
          totalChargeCents,
        },
      },
    });
  } catch (err: any) {
    console.error("AUTO_CREATE_RENTAL_FATAL:", err);
    return jsonError(500, "Server error", {
      message: err?.message || String(err),
    });
  }
}