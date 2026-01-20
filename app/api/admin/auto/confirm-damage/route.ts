import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await req.json();
    const { rentalId, notes } = body;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    // Ensure rental exists & returned
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select("id, return_confirmed_at")
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (!rental.return_confirmed_at) {
      return NextResponse.json(
        { error: "Return not confirmed yet" },
        { status: 400 }
      );
    }

    // Mark damage confirmed
    await supabase
      .from("rentals")
      .update({ damage_confirmed: true })
      .eq("id", rentalId);

    // Audit log
    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_role: "admin",
      event_type: "damage_confirmed",
      event_payload: { notes: notes || null },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Server error" },
      { status: 500 }
    );
  }
}
