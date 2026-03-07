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

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();
    const body = await req.json().catch(() => ({}));

    const requestId = String(body?.requestId || "").trim();
    const businessAccountId = parseBusinessAccountId(body?.businessAccountId);

    if (!requestId) return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    if (!businessAccountId) {
      return NextResponse.json({ error: "Missing or invalid businessAccountId" }, { status: 400 });
    }

    const access = await ensureBusinessAccess(supabase, user.id, businessAccountId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.code });

    const { data: source, error: sourceErr } = await supabase
      .from("doc_requests")
      .select("id,title,description,service_type,delivery_method,phone,business_account_id")
      .eq("id", requestId)
      .eq("business_account_id", businessAccountId)
      .maybeSingle();

    if (sourceErr) return NextResponse.json({ error: sourceErr.message }, { status: 500 });
    if (!source) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    const { data: cloned, error: cloneErr } = await supabase
      .from("doc_requests")
      .insert({
        user_id: user.id,
        business_account_id: businessAccountId,
        title: source.title || "Copied Docs Request",
        description: source.description || "",
        service_type: source.service_type || "print_scan_delivery",
        delivery_method: source.delivery_method || "delivery",
        phone: source.phone || null,
        status: "draft",
        paid: false,
        docs_terms_accepted: false,
      })
      .select("id")
      .single();

    if (cloneErr || !cloned?.id) {
      return NextResponse.json({ error: cloneErr?.message || "Failed to duplicate request" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, requestId: cloned.id });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Missing Authorization header" || msg === "Invalid or expired token" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
