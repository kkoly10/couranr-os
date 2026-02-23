// app/api/docs/submit-request/route.ts
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

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || "");

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const { data: requestRow, error: reqErr } = await supabase
      .from("doc_requests")
      .select("*")
      .eq("id", requestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reqErr || !requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const title = String(requestRow.title || "").trim();
    const serviceType = String(requestRow.service_type || "").trim();

    if (!title) {
      return NextResponse.json({ error: "Please add a request title." }, { status: 400 });
    }
    if (!serviceType) {
      return NextResponse.json({ error: "Please choose a service type." }, { status: 400 });
    }

    const now = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from("doc_requests")
      .update({
        status: "submitted",
        submitted_at: requestRow.submitted_at || now,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (updErr || !updated) {
      return NextResponse.json({ error: updErr?.message || "Failed to submit request" }, { status: 500 });
    }

    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "request_submitted",
      event_payload: {
        submitted_at: now,
        service_type: updated.service_type,
      },
    });

    return NextResponse.json({ ok: true, request: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
