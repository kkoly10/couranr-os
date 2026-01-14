import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    // ---------- AUTH ----------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    );

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ---------- INPUT ----------
    const body = await req.json().catch(() => ({}));
    const rentalId = String(body.rentalId || "");
    if (!rentalId) {
      return NextResponse.json(
        { error: "Missing rentalId" },
        { status: 400 }
      );
    }

    // ---------- LOAD RENTAL ----------
    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select(
        `
        id,
        user_id,
        pickup_confirmed_at,
        return_confirmed_at
      `
      )
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) {
      return NextResponse.json(
        { error: "Rental not found" },
        { status: 404 }
      );
    }

    // ---------- OWNERSHIP ----------
    if (rental.user_id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------- STATE GUARDS ----------
    if (!rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Pickup has not been confirmed yet" },
        { status: 400 }
      );
    }

    if (rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Return already confirmed" },
        { status: 400 }
      );
    }

    // ---------- VERIFY RETURN PHOTOS ----------
    const { data: photos } = await supabase
      .from("rental_condition_photos")
      .select("phase")
      .eq("rental_id", rentalId);

    const phases = new Set((photos || []).map((p: any) => p.phase));

    if (!phases.has("return_exterior") || !phases.has("return_interior")) {
      return NextResponse.json(
        {
          error:
            "Return photos required (both exterior and interior) before confirming return",
        },
        { status: 400 }
      );
    }

    // ---------- UPDATE RENTAL ----------
    const now = new Date().toISOString();

    const { error: uErr } = await supabase
      .from("rentals")
      .update({
        return_confirmed_at: now,
        status: "returned",
      })
      .eq("id", rentalId);

    if (uErr) {
      return NextResponse.json(
        { error: uErr.message },
        { status: 500 }
      );
    }

    // ---------- AUDIT EVENT ----------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: auth.user.id,
      actor_role: "renter",
      event_type: "return_confirmed",
      event_payload: {
        at: now,
      },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("confirm-return error:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}