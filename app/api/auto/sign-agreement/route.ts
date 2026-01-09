import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const { rentalId, signedName } = await req.json();

    if (!rentalId || !signedName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase.from("rental_agreements").insert({
      rental_id: rentalId,
      signed_name: signedName,
      agreement_version: "v1",
      ip_address: "unknown",
    });

    await supabase
      .from("rentals")
      .update({ status: "awaiting_payment" })
      .eq("id", rentalId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to sign agreement" },
      { status: 500 }
    );
  }
}