import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: NextRequest) {
  try {
    // -----------------------------
    // AUTH (Bearer token)
    // -----------------------------
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
    const userId = u.user.id;

    // -----------------------------
    // BODY
    // -----------------------------
    const body = await req.json().catch(() => ({}));
    const rentalId = String(body?.rentalId || "");
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    // -----------------------------
    // ROLE (admin override allowed)
    // -----------------------------
    const { data: prof } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    const isAdmin = prof?.role === "admin";

    // -----------------------------
    // LOAD RENTAL
    // -----------------------------
    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select(`
        id,
        user_id,
        verification_status,
        docs_complete,
        agreement_signed,
        paid,
        lockbox_code_released_at,
        pickup_confirmed_at
      `)
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Owner enforcement (unless admin)
    if (!isAdmin && rental.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // -----------------------------
    // HARD GATES (fatal if missing)
    // -----------------------------
    if (rental.pickup_confirmed_at) {
      return NextResponse.json({ error: "Pickup already confirmed" }, { status: 400 });
    }

    if (rental.verification_status !== "approved") {
      return NextResponse.json({ error: "Rental not approved" }, { status: 400 });
    }

    if (!rental.docs_complete) {
      return NextResponse.json({ error: "Documents not complete" }, { status: 400 });
    }

    if (!rental.agreement_signed) {
      return NextResponse.json({ error: "Agreement not signed" }, { status: 400 });
    }

    if (!rental.paid) {
      return NextResponse.json({ error: "Payment not completed" }, { status: 400 });
    }

    if (!rental.lockbox_code_released_at) {
      return NextResponse.json({ error: "Lockbox has not been released yet" }, { status: 400 });
    }

    // -----------------------------
    // PHOTO GATE: pickup exterior + interior must exist
    // (prevents skipping straight to pickup confirm)
    // -----------------------------
    const { data: photos, error: pErr } = await supabase
      .from("rental_condition_photos")
      .select("phase")
      .eq("rental_id", rentalId);

    if (pErr) {
      return NextResponse.json({ error: "Failed to load condition photos" }, { status: 500 });
    }

    const phases = new Set((photos || []).map((p: any) => p.phase));
    const hasExterior = phases.has("pickup_exterior");
    const hasInterior = phases.has("pickup_interior");

    if (!hasExterior || !hasInterior) {
      return NextResponse.json(
        { error: "Pickup photos required (exterior + interior) before confirming pickup." },
        { status: 400 }
      );
    }

    // -----------------------------
    // CONFIRM PICKUP
    // -----------------------------
    const now = new Date().toISOString();

    const { error: upErr } = await supabase
      .from("rentals")
      .update({ pickup_confirmed_at: now })
      .eq("id", rentalId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    // -----------------------------
    // AUDIT EVENT
    // -----------------------------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: userId,
      actor_role: isAdmin ? "admin" : "customer",
      event_type: "pickup_confirmed",
      event_payload: {
        confirmed_at: now,
        method: "api",
      },
    });

    return NextResponse.json({ ok: true, pickup_confirmed_at: now });
  } catch (e: any) {
    console.error("confirm-pickup error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}