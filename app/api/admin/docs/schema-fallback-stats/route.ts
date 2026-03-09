import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

type EventRow = {
  created_at: string | null;
  event_payload: Record<string, any> | null;
};

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function safeDateKey(v: string | null) {
  if (!v) return "unknown";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") || "14") || 14));
    const fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const supabaseSrv = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    const { data, error } = await supabaseSrv
      .from("doc_request_events")
      .select("created_at,event_payload")
      .eq("event_type", "schema_fallback_used")
      .gte("created_at", fromIso)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data || []) as EventRow[];
    const byDay: Record<string, number> = {};
    const byColumn: Record<string, number> = {};

    for (const row of rows) {
      const dayKey = safeDateKey(row.created_at);
      byDay[dayKey] = (byDay[dayKey] || 0) + 1;

      const cols = Array.isArray(row.event_payload?.update_missing_columns)
        ? row.event_payload?.update_missing_columns
        : [];
      for (const col of cols) {
        const key = String(col || "").trim();
        if (!key) continue;
        byColumn[key] = (byColumn[key] || 0) + 1;
      }
    }

    const byDayList = Object.entries(byDay)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));

    const topMissingColumns = Object.entries(byColumn)
      .map(([column, count]) => ({ column, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return NextResponse.json({
      ok: true,
      lookback_days: days,
      total_events: rows.length,
      by_day: byDayList,
      top_missing_columns: topMissingColumns,
    });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Missing Authorization header" || msg === "Invalid or expired token" ? 401 : msg === "Admin access required" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
