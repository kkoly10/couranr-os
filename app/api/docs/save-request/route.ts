// app/api/docs/save-request/route.ts
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

    const { data: existing, error: existingErr } = await supabase
      .from("doc_requests")
      .select("*")
      .eq("id", requestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingErr || !existing) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const patch: any = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body?.serviceType === "string") patch.service_type = body.serviceType.slice(0, 80);
    if (typeof body?.title === "string") patch.title = body.title.slice(0, 200);
    if (typeof body?.description === "string") patch.description = body.description.slice(0, 5000);
    if (typeof body?.deliveryMethod === "string") patch.delivery_method = body.deliveryMethod.slice(0, 80);
    if (typeof body?.phone === "string") patch.phone = body.phone.slice(0, 50);

    const { data: updated, error: updErr } = await supabase
      .from("doc_requests")
      .update(patch)
      .eq("id", requestId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (updErr || !updated) {
      return NextResponse.json({ error: updErr?.message || "Failed to save" }, { status: 500 });
    }

    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "request_updated",
      event_payload: {
        service_type: patch.service_type ?? undefined,
        title: patch.title ?? undefined,
        delivery_method: patch.delivery_method ?? undefined,
      },
    });

    return NextResponse.json({ ok: true, request: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
