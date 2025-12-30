import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createDeliveryOrderFlow } from "../../../../lib/delivery/createDeliveryOrderFlow";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const parts = auth.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") return parts[1];
  return null;
}

export async function POST(req: Request) {
  try {
    // 1) Require a Bearer token from the client
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2) Validate token with Supabase (server-side)
    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = userRes.user;

    // 3) Check role = customer
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profErr) {
      return NextResponse.json({ error: "Profile lookup failed" }, { status: 500 });
    }

    if (profile?.role !== "customer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 4) Read body (delivery details from checkout)
    const body = await req.json();

    const {
      pickupAddress,
      dropoffAddress,
      estimatedMiles,
      weightLbs,
      rush,
      signatureRequired,
      stops,
      totalCents,
      scheduledAt, // can be null
    } = body;

    if (!pickupAddress || !dropoffAddress) {
      return NextResponse.json(
        { error: "pickupAddress and dropoffAddress are required" },
        { status: 400 }
      );
    }

    if (typeof totalCents !== "number" || totalCents < 50) {
      return NextResponse.json({ error: "totalCents is invalid" }, { status: 400 });
    }

    // 5) Orchestrate: create addresses, order, delivery, authorize payment, return clientSecret
    const result = await createDeliveryOrderFlow({
      customerId: user.id,
      pickupAddress,
      dropoffAddress,
      estimatedMiles: Number(estimatedMiles ?? 0),
      weightLbs: Number(weightLbs ?? 0),
      rush: Boolean(rush),
      signatureRequired: Boolean(signatureRequired),
      stops: Number(stops ?? 0),
      totalCents: Number(totalCents),
      scheduledAt: scheduledAt ?? null,
    });

    return NextResponse.json({
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      amountCents: result.totalCents,
      clientSecret: result.clientSecret,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to start checkout" },
      { status: 500 }
    );
  }
}