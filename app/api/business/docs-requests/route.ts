import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";
import { ensureBusinessAccess, parseBusinessAccountId } from "@/lib/businessAccount";

export const dynamic = "force-dynamic";

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function isRelationMissingError(message: string) {
  const m = String(message || "").toLowerCase();
  return (m.includes("relation") && m.includes("does not exist")) || m.includes("schema cache");
}

const SELECT = [
  "id",
  "request_code",
  "service_type",
  "title",
  "status",
  "paid",
  "quoted_total_cents",
  "total_cents",
  "created_at",
  "submitted_at",
  "completed_at",
  "business_account_id",
].join(",");

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const url = new URL(req.url);
    const status = String(url.searchParams.get("status") || "").trim();
    const businessAccountId = parseBusinessAccountId(url.searchParams.get("businessAccountId"));

    if (!businessAccountId) {
      return NextResponse.json({ error: "Missing or invalid businessAccountId" }, { status: 400 });
    }

    const access = await ensureBusinessAccess(supabase, user.id, businessAccountId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.code });

    let primary = supabase
      .from("doc_requests")
      .select(SELECT)
      .eq("business_account_id", businessAccountId)
      .order("created_at", { ascending: false });

    if (status) primary = primary.eq("status", status);

    const main = await primary;
    if (main.error && !isRelationMissingError(main.error.message || "")) {
      return NextResponse.json({ error: main.error.message }, { status: 500 });
    }

    if (!main.error) {
      return NextResponse.json({ ok: true, requests: main.data || [] });
    }

    let fallback = supabase
      .from("docs_requests")
      .select(SELECT)
      .eq("business_account_id", businessAccountId)
      .order("created_at", { ascending: false });

    if (status) fallback = fallback.eq("status", status);

    const alt = await fallback;
    if (alt.error) return NextResponse.json({ error: alt.error.message }, { status: 500 });

    return NextResponse.json({ ok: true, requests: alt.data || [] });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Missing Authorization header" || msg === "Invalid or expired token" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
