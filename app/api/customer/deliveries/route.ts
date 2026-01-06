import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/customer/deliveries
 * Authenticated customer deliveries
 */
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: deliveries, error } = await supabaseAdmin
      .from("deliveries")
      .select(
        `
        id,
        status,
        created_at,
        estimated_miles,
        weight_lbs,
        orders (
          order_number,
          total_cents
        ),
        pickup_address:pickup_address_id ( address_line ),
        dropoff_address:dropoff_address_id ( address_line )
      `
      )
      .eq("orders.customer_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Deliveries fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch deliveries" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      deliveries: (deliveries ?? []).map((d: any) => ({
        id: d.id,
        status: d.status,
        createdAt: d.created_at,
        miles: d.estimated_miles,
        weight: d.weight_lbs,
        orderNumber: d.orders?.order_number ?? "—",
        totalCents: d.orders?.total_cents ?? 0,
        pickup: d.pickup_address?.address_line ?? "—",
        dropoff: d.dropoff_address?.address_line ?? "—",
      })),
    });
  } catch (err) {
    console.error("Customer deliveries fatal:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}