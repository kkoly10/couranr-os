import { NextResponse } from "next/server";
import { supabasePublic as supabase } from "@/lib/supabasePublic";

// Reads live data, so it must not be prerendered at build time. Without this
// Next evaluates the handler during `next build`, which needs env vars present.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { data, error } = await supabase
    .from("vehicles")
    .select(`
      id,
      year,
      make,
      model,
      trim,
      color,
      daily_rate_cents,
      weekly_rate_cents,
      deposit_cents,
      status,
      image_urls
    `)
    .eq("status", "available")
    .order("year", { ascending: false });

  if (error) {
    console.error("Vehicles fetch error:", error);
    return NextResponse.json(
      { error: "Failed to load vehicles" },
      { status: 500 }
    );
  }

  return NextResponse.json({ vehicles: data || [] });
}
