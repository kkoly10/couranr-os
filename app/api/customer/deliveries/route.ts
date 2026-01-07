import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

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

    // 🔐 Identify user
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 📦 Fetch customer deliveries (NO LEAKAGE)
    const { data, error } = await supabase
      .from("deliveries")
      .select(
        `
        id,
        status,
        created_at,
        estimated_miles,
        weight_lbs,

        orders!inner (
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
      console.error("Customer deliveries error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // 🧠 Normalize for frontend
    const deliveries = (data ?? []).map((d: any) => ({
      id: d.id,
      status: d.status,
      createdAt: d.created_at,
      estimatedMiles: d.estimated_miles,
      weightLbs: d.weight_lbs,

      order: {
        orderNumber: d.orders.order_number,
        totalCents: d.orders.total_cents,
        status: d.orders.status,
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