import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ✅ Prevent Next from trying to statically optimize this route
export const dynamic = "force-dynamic";

function first<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

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

    // 🔐 Confirm user from token (RLS-safe)
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /**
     * IMPORTANT:
     * - deliveries should reference orders via order_id (FK)
     * - pickup_address_id and dropoff_address_id reference addresses table
     *
     * Also:
     * Supabase can sometimes return nested relations as arrays depending on FK direction.
     * So we normalize for both object/array shapes.
     */
    const { data, error } = await supabase
      .from("deliveries")
      .select(
        `
        id,
        status,
        created_at,
        estimated_miles,
        weight_lbs,
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

    // ✅ Normalize
    const normalized = (data ?? []).map((d: any) => {
      const order = first(d.orders);
      const pickup = first(d.pickup_address);
      const dropoff = first(d.dropoff_address);

      return {
        id: d.id,
        status: d.status,
        createdAt: d.created_at,
        estimatedMiles: d.estimated_miles,
        weightLbs: d.weight_lbs,

        order: {
          orderNumber: order?.order_number ?? "—",
          totalCents: order?.total_cents ?? 0,
          status: order?.status ?? "unknown",
        },

        pickupAddress: pickup?.address_line ?? "—",
        dropoffAddress: dropoff?.address_line ?? "—",
      };
    });

    // ✅ Debug output (so we can STOP guessing)
    // You can remove raw later once verified.
    return NextResponse.json({
      userId: user.id,
      count: normalized.length,
      deliveries: normalized,
      raw: data, // <-- this is the truth; check what shape Supabase returns
    });
  } catch (err: any) {
    console.error("Customer deliveries fatal error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}