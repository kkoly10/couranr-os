import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function asSingle<T>(v: any): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return v as T;
}

export async function POST(req: Request) {
  try {
    // ---------------------------
    // AUTH (Bearer token required)
    // ---------------------------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // ---------------------------
    // ADMIN CHECK (profiles.role)
    // ---------------------------
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("id, role, email")
      .eq("id", auth.user.id)
      .single();

    if (profErr || !prof || prof.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------------------------
    // INPUT
    // ---------------------------
    const body = await req.json().catch(() => ({}));

    const rentalId = String(body.rentalId || "");
    const decision = String(body.decision || ""); // refunded | withheld
    const amountCents = Number(body.amountCents ?? 0);
    const reason = body.reason ? String(body.reason) : null;

    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    if (decision !== "refunded" && decision !== "withheld") {
      return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    }

    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return NextResponse.json({ error: "Invalid amountCents" }, { status: 400 });
    }

    // If refunded, always force amount withheld to 0
    const finalWithheldCents = decision === "withheld" ? amountCents : 0;

    // ---------------------------
    // LOAD RENTAL (+ renter email, vehicle)
    // NOTE: Supabase relations sometimes return arrays; normalize safely.
    // ---------------------------
    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select(
        `
        id,
        user_id,
        status,
        paid,
        return_confirmed_at,
        deposit_refund_status,
        deposit_refund_amount_cents,
        profiles ( email ),
        vehicles ( year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    // Guardrails (recommended)
    if (!rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Return must be confirmed before deposit decision." },
        { status: 400 }
      );
    }

    // If you want to block deposit decisions when unpaid:
    if (!rental.paid) {
      return NextResponse.json(
        { error: "Rental is not marked paid; deposit decision blocked." },
        { status: 400 }
      );
    }

    // ---------------------------
    // UPDATE RENTAL (deposit fields)
    // ---------------------------
    const nowIso = new Date().toISOString();

    const { error: uErr } = await supabase
      .from("rentals")
      .update({
        deposit_refund_status: decision,
        deposit_refund_amount_cents: finalWithheldCents,
        // optional: set to pending before this step in your flow
        // status: rental.status === "returned" ? "closed" : rental.status,
      })
      .eq("id", rentalId);

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    // ---------------------------
    // AUDIT EVENT
    // ---------------------------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: auth.user.id,
      actor_role: "admin",
      event_type: "deposit_decision",
      event_payload: {
        decision,
        withheld_cents: finalWithheldCents,
        reason,
        at: nowIso,
      },
    });

    // ---------------------------
    // EMAIL NOTIFICATION (Resend)
    // - Don’t crash build if env missing: create client inside handler
    // ---------------------------
    const renterProfile = asSingle<{ email?: string }>(rental.profiles);
    const renterEmail = renterProfile?.email || null;

    const vehicle = asSingle<{ year?: any; make?: any; model?: any }>(rental.vehicles);
    const carLabel = vehicle
      ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() || "your rental"
      : "your rental";

    // Only attempt email if we have both:
    // - renter email
    // - RESEND_API_KEY
    if (renterEmail && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      const subject =
        decision === "refunded"
          ? "Couranr Auto — Deposit refunded"
          : "Couranr Auto — Deposit withheld (review)";

      const moneyLine =
        decision === "withheld"
          ? `Withheld amount: $${(finalWithheldCents / 100).toFixed(2)}`
          : `Withheld amount: $0.00`;

      const reasonLine =
        decision === "withheld" && reason ? `Reason: ${reason}` : "";

      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h2 style="margin:0 0 12px">Deposit update</h2>
          <p style="margin:0 0 8px">Rental: <strong>${carLabel}</strong></p>
          <p style="margin:0 0 8px">Decision: <strong>${decision.toUpperCase()}</strong></p>
          <p style="margin:0 0 8px">${moneyLine}</p>
          ${reasonLine ? `<p style="margin:0 0 8px">${reasonLine}</p>` : ""}
          <p style="margin:16px 0 0;color:#555">
            If you believe this is incorrect, reply to this email with details and photos.
          </p>
        </div>
      `;

      try {
        await resend.emails.send({
          from: requireEnv("RESEND_FROM_EMAIL"), // e.g. "Couranr <no-reply@couranr.com>" or your verified sender
          to: renterEmail,
          subject,
          html,
        });
      } catch (emailErr) {
        // Do NOT fail the deposit decision if email fails — log only
        console.error("Resend email failed:", emailErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("deposit-decision error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
