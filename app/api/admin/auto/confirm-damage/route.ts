import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace("Bearer ", "").trim();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = userRes.user.id;

    // Role check
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const rentalId = body.rentalId;
    const notes = body.notes || null;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    // Load rental
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select("id, return_confirmed_at, damage_confirmed")
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (!rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Return must be confirmed before damage confirmation" },
        { status: 400 }
      );
    }

    if (rental.damage_confirmed) {
      return NextResponse.json(
        { error: "Damage already confirmed" },
        { status: 400 }
      );
    }

    // Update rental
    const { error: updateErr } = await supabase
      .from("rentals")
      .update({
        damage_confirmed: true,
        damage_confirmed_at: new Date().toISOString(),
        damage_notes: notes,
      })
      .eq("id", rentalId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Audit event
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: userId,
      actor_role: "admin",
      event_type: "damage_confirmed",
      event_payload: { notes },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
