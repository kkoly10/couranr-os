// app/api/docs/my-requests/route.ts
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

function isRelationMissingError(message: string) {
  const m = String(message || "").toLowerCase();
  return (m.includes("relation") && m.includes("does not exist")) || m.includes("schema cache");
}

const REQUEST_LIST_SELECT = [
  "id",
  "request_code",
  "service_type",
  "title",
  "status",
  "paid",
  "total_cents",
  "amount_subtotal_cents",
  "created_at",
  "submitted_at",
  "completed_at",
].join(",");

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const primary = await supabase
      .from("doc_requests")
      .select(REQUEST_LIST_SELECT)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (primary.error && !isRelationMissingError(primary.error.message || "")) {
      return NextResponse.json({ error: primary.error.message }, { status: 500 });
    }

    if (!primary.error) {
      return NextResponse.json({ requests: primary.data || [] });
    }

    const fallback = await supabase
      .from("docs_requests")
      .select(REQUEST_LIST_SELECT)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }

    return NextResponse.json({ requests: fallback.data || [] });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}