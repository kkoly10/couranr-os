// app/api/auto/delete-draft/route.ts
import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  try {
    // 1. Verify the user securely
    const user = await getUserFromRequest(req);
    const admin = adminClient();
    
    // 2. Parse the request to find which rental to delete
    const body = await req.json().catch(() => ({}));
    const rentalId = body.rentalId;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rental ID" }, { status: 400 });
    }

    // 3. Look up the rental to ensure they own it and that it is actually a draft
    const { data: rental, error: fetchErr } = await admin
      .from("rentals")
      .select("user_id, status")
      .eq("id", rentalId)
      .single();

    if (fetchErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (rental.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden - You do not own this rental" }, { status: 403 });
    }

    if (rental.status !== "draft") {
      return NextResponse.json({ error: "You can only delete drafts, not active or past rentals." }, { status: 400 });
    }

    // 4. Delete the rental record securely
    const { error: deleteErr } = await admin
      .from("rentals")
      .delete()
      .eq("id", rentalId);

    if (deleteErr) {
      throw new Error(deleteErr.message);
    }

    return NextResponse.json({ success: true }, { status: 200 });
    
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
