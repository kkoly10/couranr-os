import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/customer/deliveries
 * Returns deliveries belonging to the authenticated customer
 */
export async function GET(req: Request) {
  try {
    // 1️⃣ Auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    // 2️⃣ Supabase client scoped to user session
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    // 3️⃣ Fetch deliveries with proper address joins
    const { data, error } = await supabase
      .from("deliveries")
      .select(`
        id,
        status,
        created_at,
        pickup_address:pickup_address_id (
          address_line
        ),
        dropoff_address:dropoff_address_id (
          address_line
        ),
        orders (
          order_number,
          total_cents,
          status
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Customer deliveries error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // 4️⃣ Normalize response for frontend
    const deliveries = (data ?? []).map((d: any) => ({
      id: d.id,
      status: d.status,
      createdAt: d.created_at,
      pickupAddress: d.pickup_address?.address_line ?? "—",
      dropoffAddress: d.dropoff_address?.address_line ?? "—",
      order: {
        orderNumber: d.orders?.order_number ?? "—",
        totalCents: d.orders?.total_cents ?? 0,
        status: d.orders?.status ?? "unknown",
      },
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