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

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const businessAccountId = parseBusinessAccountId(new URL(req.url).searchParams.get("businessAccountId"));
    if (!businessAccountId) {
      return NextResponse.json({ error: "Missing or invalid businessAccountId" }, { status: 400 });
    }

    const access = await ensureBusinessAccess(supabase, user.id, businessAccountId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.code });

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthIso = monthStart.toISOString();

    const [deliveriesRes, docsRes] = await Promise.all([
      supabase
        .from("deliveries")
        .select("id,created_at,status,order:order_id(total_cents)")
        .eq("business_account_id", businessAccountId)
        .gte("created_at", monthIso),
      supabase
        .from("doc_requests")
        .select("id,created_at,paid,total_cents,amount_subtotal_cents")
        .eq("business_account_id", businessAccountId)
        .gte("created_at", monthIso),
    ]);

    if (deliveriesRes.error) return NextResponse.json({ error: deliveriesRes.error.message }, { status: 500 });
    if (docsRes.error) return NextResponse.json({ error: docsRes.error.message }, { status: 500 });

    const deliveries = deliveriesRes.data || [];
    const docs = docsRes.data || [];

    const deliveryBilledCents = deliveries.reduce((sum: number, d: any) => {
      const order = Array.isArray(d.order) ? d.order[0] : d.order;
      return sum + Number(order?.total_cents || 0);
    }, 0);

    const docsBilledCents = docs.reduce(
      (sum: number, r: any) => sum + Number(r.total_cents ?? r.amount_subtotal_cents ?? 0),
      0
    );

    const docsUnpaidCents = docs.reduce(
      (sum: number, r: any) => sum + (r.paid ? 0 : Number(r.total_cents ?? r.amount_subtotal_cents ?? 0)),
      0
    );

    return NextResponse.json({
      ok: true,
      summary: {
        monthStart: monthIso,
        deliveriesCount: deliveries.length,
        docsCount: docs.length,
        billedCents: deliveryBilledCents + docsBilledCents,
        unpaidCents: docsUnpaidCents,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Missing Authorization header" || msg === "Invalid or expired token" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
