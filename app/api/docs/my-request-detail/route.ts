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

async function addSignedUrls(
  supabase: ReturnType<typeof svc>,
  files: Record<string, any>[]
) {
  const out: Record<string, any>[] = [];

  for (const f of files || []) {
    let signed_url: string | null = null;

    if (f.storage_bucket && f.storage_path) {
      const { data, error } = await supabase.storage
        .from(String(f.storage_bucket))
        .createSignedUrl(String(f.storage_path), 60 * 60);

      if (!error) {
        signed_url = data?.signedUrl ?? null;
      }
    }

    out.push({
      id: f.id ?? null,
      request_id: f.request_id ?? null,
      file_name: f.file_name ?? null,
      display_name: f.display_name ?? f.file_name ?? null,
      mime_type: f.mime_type ?? null,
      size_bytes: f.size_bytes ?? null,
      storage_bucket: f.storage_bucket ?? null,
      storage_path: f.storage_path ?? null,
      created_at: f.created_at ?? null,
      signed_url,
    });
  }

  return out;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const requestId = req.nextUrl.searchParams.get("requestId")?.trim() || "";
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const { data: request, error: reqErr } = await supabase
      .from("doc_requests")
      .select(
        `
        id,
        user_id,
        business_account_id,
        request_code,
        service_type,
        service_label,
        title,
        description,
        delivery_method,
        phone,
        status,
        paid,
        amount_subtotal_cents,
        delivery_fee_cents,
        rush_fee_cents,
        tax_cents,
        total_cents,
        quoted_total_cents,
        final_total_cents,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        docs_terms_accepted_at,
        docs_terms_version,
        terms_accepted_at,
        terms_version,
        created_at,
        updated_at,
        submitted_at,
        completed_at,
        paid_at
      `
      )
      .eq("id", requestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reqErr) {
      return NextResponse.json({ error: reqErr.message }, { status: 500 });
    }

    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const { data: fileRows, error: filesErr } = await supabase
      .from("doc_request_files")
      .select(
        "id,request_id,file_name,display_name,mime_type,size_bytes,storage_bucket,storage_path,created_at"
      )
      .eq("request_id", requestId)
      .order("created_at", { ascending: false });

    if (filesErr) {
      return NextResponse.json({ error: filesErr.message }, { status: 500 });
    }

    const files = await addSignedUrls(
      supabase,
      (fileRows || []) as Record<string, any>[]
    );

    const { data: events, error: eventsErr } = await supabase
      .from("doc_request_events")
      .select("id,request_id,actor_user_id,actor_role,event_type,event_payload,created_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    if (eventsErr) {
      return NextResponse.json({ error: eventsErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      request,
      files,
      events: events || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}