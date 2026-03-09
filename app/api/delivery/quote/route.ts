// app/api/delivery/quote/route.ts

import { NextResponse } from "next/server";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";
import { createClient } from "@supabase/supabase-js";
import { parseBusinessAccountId, ensureBusinessAccess } from "@/lib/businessAccount";
import { getUserFromRequest } from "@/app/lib/auth";
import { applyBusinessDeliveryPricing, getBusinessPricingProfile } from "@/lib/businessPricing";

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const supabase = svc();

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

    const requestedBusinessAccountId = parseBusinessAccountId(body?.businessAccountId);
    if (body?.businessAccountId && !requestedBusinessAccountId) {
      return NextResponse.json({ error: "Invalid businessAccountId" }, { status: 400 });
    }

    if (!requestedBusinessAccountId) {
      return NextResponse.json({
        ...result,
        pricingContext: { mode: "personal", strategy: "base" },
      });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Sign in required for business pricing preview." },
        { status: 401 }
      );
    }

    const user = await getUserFromRequest(req as any);
    const access = await ensureBusinessAccess(supabase as any, user.id, requestedBusinessAccountId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.code });
    }

    const profile = await getBusinessPricingProfile(supabase as any, requestedBusinessAccountId);
    const adjusted = applyBusinessDeliveryPricing(result.amountCents, profile);

    return NextResponse.json({
      ...result,
      amountCents: adjusted.amountCents,
      breakdown: {
        ...result.breakdown,
        total: adjusted.amountCents / 100,
      },
      pricingContext: {
        mode: "business",
        businessAccountId: requestedBusinessAccountId,
        strategy: adjusted.strategy,
      },
    });
  } catch (err: any) {
    console.error("Quote error:", err);

    return NextResponse.json(
      { error: err.message || "Failed to compute quote" },
      { status: 500 }
    );
  }
}
