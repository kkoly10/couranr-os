import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rentalId = url.searchParams.get("rentalId") || "";

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: rental, error } = await supabase
      .from("rentals")
      .select("id,user_id,verification_status,paid,lockbox_code,condition_photos_status,pickup_confirmed_at")
      .eq("id", rentalId)
      .single();

    if (error || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    if (rental.user_id !== u.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (rental.verification_status !== "approved") {
      return NextResponse.json({ error: "Awaiting admin approval." }, { status: 400 });
    }
    if (!rental.paid) {
      return NextResponse.json({ error: "Payment required before access." }, { status: 400 });
    }
    if (!rental.lockbox_code) {
      return NextResponse.json({ error: "Lockbox code not assigned yet." }, { status: 400 });
    }
    if (rental.condition_photos_status !== "pickup_exterior_done" && rental.condition_photos_status !== "pickup_interior_done"
        && rental.condition_photos_status !== "return_exterior_done" && rental.condition_photos_status !== "return_interior_done"
        && rental.condition_photos_status !== "complete") {
      return NextResponse.json({ error: "Upload pickup exterior photos first." }, { status: 400 });
    }

    // Mark release timestamp once (optional)
    if (!rental.pickup_confirmed_at) {
      await supabase.from("rentals").update({ lockbox_code_released_at: new Date().toISOString() }).eq("id", rentalId);
      await supabase.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: u.user.id,
        actor_role: "customer",
        event_type: "lockbox_code_viewed",
        event_payload: {},
      });
    }

    return NextResponse.json({ code: rental.lockbox_code });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}