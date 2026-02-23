// app/api/docs/create-draft/route.ts
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

function makeRequestCode() {
  const d = new Date();
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `DOC-${y}${m}${day}-${rand}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const body = await req.json().catch(() => ({}));

    const serviceType = String(body?.serviceType || "printing_delivery");
    const title = String(body?.title || "Docs Request").slice(0, 200);

    const requestCode = makeRequestCode();

    const { data: inserted, error } = await supabase
      .from("doc_requests")
      .insert({
        user_id: user.id,
        request_code: requestCode,
        service_type: serviceType,
        title,
        status: "draft",
        paid: false,
      })
      .select("*")
      .single();

    if (error || !inserted) {
      return NextResponse.json({ error: error?.message || "Failed to create draft" }, { status: 500 });
    }

    await supabase.from("doc_request_events").insert({
      request_id: inserted.id,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "draft_created",
      event_payload: { request_code: requestCode },
    });

    return NextResponse.json({ ok: true, request: inserted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
