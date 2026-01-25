export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { rentalId, notes } = await req.json();

    if (!rentalId || !notes) {
      return NextResponse.json(
        { error: "Missing rentalId or notes" },
        { status: 400 }
      );
    }

    // ---------- AUTH ----------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: userRes } = await supabaseAuth.auth.getUser();
    const user = userRes?.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------- UPDATE ----------
    const { error } = await supabase
      .from("rentals")
      .update({
        damage_confirmed: true,
        damage_confirmed_at: new Date().toISOString(),
        damage_notes: notes,
      })
      .eq("id", rentalId);

    if (error) throw error;

    // ---------- AUDIT ----------
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "admin",
      event_type: "damage_confirmed",
      event_payload: { notes },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Confirm damage error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}