import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    }
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

    const { data, error } = await supabase
      .from("deliveries")
      .select(
        `
        id,
        status,
        created_at,
        estimated_miles,
        weight_lbs,
        recipient_name,
        recipient_phone,
        order_id,

        orders:order_id (
          id,
          order_number,
          total_cents,
          status,
          customer_id
        ),

        pickup_address:pickup_address_id (
          address_line
        ),

        dropoff_address:dropoff_address_id (
          address_line
        )
      `
      )
      .eq("orders.customer_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Customer deliveries query error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deliveries = (data ?? []).map((d: any) => {
      const order = first(d.orders);
      const pickup = first(d.pickup_address);
      const dropoff = first(d.dropoff_address);

      return {
        id: d.id,
        status: d.status,
        createdAt: d.created_at,
        estimatedMiles: d.estimated_miles,
        weightLbs: d.weight_lbs,
        recipientName: d.recipient_name ?? "",
        recipientPhone: d.recipient_phone ?? "",
        order: {
          orderNumber: order?.order_number ?? "—",
          totalCents: order?.total_cents ?? 0,
          status: order?.status ?? "unknown",
        },
        pickupAddress: pickup?.address_line ?? "—",
        dropoffAddress: dropoff?.address_line ?? "—",
      };
    });

    return NextResponse.json({ deliveries });
  } catch (err: any) {
    console.error("Customer deliveries fatal error:", err);
    const msg = err?.message || "Server error";
    const code =
      msg === "Missing Authorization header" ||
      msg === "Invalid or expired token"
        ? 401
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}