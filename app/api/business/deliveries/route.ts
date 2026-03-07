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

function firstRow(v: any) {
  return Array.isArray(v) ? (v[0] || null) : v || null;
}

function formatAddress(a: any): string | null {
  if (!a || typeof a !== "object") return null;
  const parts = [a.address_line, a.city, a.state, a.zip].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return a.label || null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const url = new URL(req.url);
    const status = String(url.searchParams.get("status") || "").trim();
    const businessAccountId = parseBusinessAccountId(url.searchParams.get("businessAccountId"));
    const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "30") || 30));

    if (!businessAccountId) {
      return NextResponse.json({ error: "Missing or invalid businessAccountId" }, { status: 400 });
    }

    const access = await ensureBusinessAccess(supabase, user.id, businessAccountId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.code });

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = supabase
      .from("deliveries")
      .select(
        `id,status,created_at,scheduled_at,recipient_name,recipient_phone,delivery_notes,business_account_id,
         pickup_address:pickup_address_id (label,address_line,city,state,zip),
         dropoff_address:dropoff_address_id (label,address_line,city,state,zip),
         order:order_id (id,order_number,total_cents,status)`,
        { count: "exact" }
      )
      .eq("business_account_id", businessAccountId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) q = q.eq("status", status);

    const { data, error, count } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const deliveries = (data || []).map((d: any) => ({
      ...d,
      pickup_address: formatAddress(firstRow(d.pickup_address)),
      dropoff_address: formatAddress(firstRow(d.dropoff_address)),
      order: firstRow(d.order),
    }));

    return NextResponse.json({
      ok: true,
      deliveries,
      pagination: {
        page,
        limit,
        total: count || 0,
        hasNext: (count || 0) > page * limit,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Missing Authorization header" || msg === "Invalid or expired token" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
