import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Direct delivery creation is disabled. Use Stripe Checkout instead.",
    },
    { status: 410 }
  );
}
