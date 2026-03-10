export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function first<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const orderId = String(req.nextUrl.searchParams.get("orderId") || "").trim();
    const deliveryId = String(req.nextUrl.searchParams.get("deliveryId") || "").trim();

    if (!orderId || !deliveryId) {
      return NextResponse.json(
        { error: "Missing orderId or deliveryId" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("deliveries")
      .select(
        `
        id,
        status,
        recipient_name,
        recipient_phone,
        delivery_notes,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        orders:order_id (
          id,
          customer_id,
          order_number,
          total_cents,
          status,
          paid_at,
          stripe_checkout_session_id,
          stripe_payment_intent_id
        )
      `
      )
      .eq("id", deliveryId)
      .eq("order_id", orderId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "Delivery confirmation not found" },
        { status: 404 }
      );
    }

    const order = first((data as any).orders);
    if (!order || String(order.customer_id || "") !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const paid =
      String(order.status || "").toLowerCase() === "paid" ||
      !!order.paid_at ||
      !!order.stripe_payment_intent_id;

    return NextResponse.json({
      ok: true,
      confirmation: {
        orderId: order.id,
        deliveryId: data.id,
        orderNumber: order.order_number ?? "",
        totalCents: Number(order.total_cents || 0),
        orderStatus: order.status ?? "unknown",
        deliveryStatus: data.status ?? "unknown",
        paid,
        recipientName: data.recipient_name ?? "",
        recipientPhone: data.recipient_phone ?? "",
        deliveryNotes: data.delivery_notes ?? "",
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      msg === "Missing Authorization header" ||
      msg === "Invalid or expired token"
        ? 401
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}