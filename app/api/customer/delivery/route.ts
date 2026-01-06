import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/customer/deliveries
 * Returns deliveries belonging to the authenticated customer
 */
export async function GET(req: Request) {
  try {
    // 1️⃣ Get auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    // 2️⃣ Validate user
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3️⃣ Confirm role = customer
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "customer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 4️⃣ Fetch deliveries for this customer
    const { data, error } = await supabaseAdmin
      .from("deliveries")
      .select(
        `
        id,
        status,
        created_at,
        estimated_miles,
        weight_lbs,
        orders (
          id,
          order_number,
          total_cents,
          status
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
      console.error("Customer deliveries error:", error);
      return NextResponse.json(
        { error: "Failed to fetch deliveries" },
        { status: 500 }
      );
    }

    // 5️⃣ Normalize response
    const deliveries = (data ?? []).map((d: any) => ({
      id: d.id,
      status: d.status,
      createdAt: d.created_at,
      estimatedMiles: d.estimated_miles,
      weightLbs: d.weight_lbs,
      order: {
        orderNumber: d.orders?.order_number ?? "—",
        totalCents: d.orders?.total_cents ?? 0,
        status: d.orders?.status ?? "unknown",
      },
      pickupAddress: d.pickup_address?.address_line ?? "—",
      dropoffAddress: d.dropoff_address?.address_line ?? "—",
    }));

    return NextResponse.json({ deliveries });
  } catch (err: any) {
    console.error("Customer deliveries fatal error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}