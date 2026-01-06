// app/api/delivery/quote/route.ts

import { NextResponse } from "next/server";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      miles,
      weightLbs,
      stops,
      rush,
      signature,
    } = body;

    // Basic validation
    if (
      typeof miles !== "number" ||
      typeof weightLbs !== "number"
    ) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    // Server-side pricing (SOURCE OF TRUTH)
    const result = computeDeliveryPrice({
      miles,
      weightLbs,
      stops: Number(stops) || 0,
      rush: !!rush,
      signature: !!signature,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Quote error:", err);

    return NextResponse.json(
      { error: err.message || "Failed to compute quote" },
      { status: 500 }
    );
  }
}