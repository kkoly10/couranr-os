import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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
      status
    `)
    .eq("status", "available")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ vehicles: data });
}