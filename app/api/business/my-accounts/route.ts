import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

type MemberRow = {
  business_account_id: string;
  role: string | null;
  status: string | null;
};

type AccountRow = {
  id: string;
  name: string | null;
  billing_email: string | null;
  status: string | null;
  timezone: string | null;
  created_at: string | null;
};

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const { data: memberships, error: memErr } = await supabase
      .from("business_members")
      .select("business_account_id,role,status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 500 });
    }

    const rows = (memberships || []) as MemberRow[];
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, accounts: [] });
    }

    const ids = Array.from(new Set(rows.map((m) => m.business_account_id).filter(Boolean)));

    const { data: accounts, error: accErr } = await supabase
      .from("business_accounts")
      .select("id,name,billing_email,status,timezone,created_at")
      .in("id", ids);

    if (accErr) {
      return NextResponse.json({ error: accErr.message }, { status: 500 });
    }

    const accountMap = new Map<string, AccountRow>();
    for (const a of (accounts || []) as AccountRow[]) accountMap.set(a.id, a);

    const merged = rows
      .map((m) => ({
        id: m.business_account_id,
        role: m.role || "viewer",
        membership_status: m.status || "active",
        ...(accountMap.get(m.business_account_id) || {
          name: null,
          billing_email: null,
          status: null,
          timezone: null,
          created_at: null,
        }),
      }))
      .filter((x) => !!x.id);

    return NextResponse.json({ ok: true, accounts: merged });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Missing Authorization header" || msg === "Invalid or expired token" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
