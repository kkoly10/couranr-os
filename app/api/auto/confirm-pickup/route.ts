import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = auth.replace("Bearer ", "");

  const {
    data: { user },
  } = await supabase.auth.getUser(token);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rentalId } = await req.json();

  if (!rentalId) {
    return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
  }

  const { data: rental } = await supabase
    .from("rentals")
    .select("*")
    .eq("id", rentalId)
    .eq("user_id", user.id)
    .single();

  if (!rental) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  if (
    rental.verification_status !== "approved" ||
    !rental.paid ||
    !rental.lockbox_code_released_at
  ) {
    return NextResponse.json(
      { error: "Pickup not allowed yet" },
      { status: 400 }
    );
  }

  if (rental.pickup_confirmed_at) {
    return NextResponse.json({ success: true });
  }

  await supabase.from("rentals").update({
    pickup_confirmed_at: new Date().toISOString(),
    status: "active",
  }).eq("id", rentalId);

  await supabase.from("rental_events").insert({
    rental_id: rentalId,
    actor_user_id: user.id,
    actor_role: "customer",
    event_type: "pickup_confirmed",
  });

  return NextResponse.json({ success: true });
}