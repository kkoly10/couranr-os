import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/notify";

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
  const { data: { user } } = await supabase.auth.getUser(token);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rentalId, decision, amountCents, reason } = await req.json();

  if (!rentalId || !["refunded", "withheld"].includes(decision)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: rental } = await supabase
    .from("rentals")
    .select("*, profiles(email)")
    .eq("id", rentalId)
    .single();

  await supabase.from("rentals").update({
    deposit_refund_status: decision,
    deposit_refund_amount_cents: amountCents ?? 0,
  }).eq("id", rentalId);

  await supabase.from("rental_events").insert({
    rental_id: rentalId,
    actor_user_id: user.id,
    actor_role: "admin",
    event_type: "deposit_decision",
    event_payload: {
      decision,
      amountCents,
      reason,
    },
  });

  if (rental?.profiles?.email) {
    await sendEmail({
      to: rental.profiles.email,
      subject: "Deposit Decision – Couranr Auto",
      html: `
        <p>Your deposit has been <strong>${decision}</strong>.</p>
        ${
          decision === "withheld"
            ? `<p>Amount withheld: $${(amountCents / 100).toFixed(2)}</p>
               <p>Reason: ${reason || "See rental details"}</p>`
            : `<p>Your refund is being processed.</p>`
        }
      `,
    });
  }

  return NextResponse.json({ success: true });
}