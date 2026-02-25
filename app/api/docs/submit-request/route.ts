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

function firstString(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function normalizeServiceType(input: any): string | null {
  const raw = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (!raw) return null;

  // Canonical DB values
  const canonical = new Set([
    "print_scan_delivery",
    "data_entry",
    "dmv_prep",
    "immigration_clerical",
    "resume_typing",
  ]);

  if (canonical.has(raw)) return raw;

  // Legacy UI aliases + variations (mapped to DB-safe values)
  const map: Record<string, string> = {
    // Printing / scan / delivery family
    print: "print_scan_delivery",
    printing: "print_scan_delivery",
    print_delivery: "print_scan_delivery",
    print_scan: "print_scan_delivery",
    print_scan_and_delivery: "print_scan_delivery",
    scan: "print_scan_delivery",
    scan_email: "print_scan_delivery",
    printing_delivery: "print_scan_delivery",
    printing_pickup: "print_scan_delivery",

    // Data entry / clerical family
    dataentry: "data_entry",
    business_data_entry: "data_entry",
    clerical_data_entry: "data_entry",
    general_admin_help: "data_entry",
    general_typing: "data_entry",

    // DMV family
    dmv: "dmv_prep",
    dmv_guidance: "dmv_prep",
    dmv_doc_prep: "dmv_prep",
    dmv_document_prep: "dmv_prep",
    dmv_doc_help: "dmv_prep",
    dmv_prep_admin: "dmv_prep",

    // Immigration family
    immigration: "immigration_clerical",
    immigration_prep: "immigration_clerical",
    immigration_doc_help: "immigration_clerical",
    immigration_document_assistance: "immigration_clerical",
    immigration_prep_help: "immigration_clerical",
    immigration_prep_admin: "immigration_clerical",

    // Resume / typing family
    resume: "resume_typing",
    resume_review: "resume_typing",
    resume_help: "resume_typing",
    typing: "resume_typing",
    typing_help: "resume_typing",
    resume_and_typing: "resume_typing",
  };

  return map[raw] || null;
}

function getMissingColumnFromError(msg: string): string | null {
  if (!msg) return null;

  let m = msg.match(/Could not find the '([^']+)' column/i);
  if (m?.[1]) return m[1];

  m = msg.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i);
  if (m?.[1]) return m[1];

  return null;
}

async function resilientUpdateDocRequest(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  payload: Record<string, any>
) {
  const current = { ...payload };

  for (let i = 0; i < 40; i++) {
    if (Object.keys(current).length === 0) {
      return { ok: true as const };
    }

    const { error } = await supabase.from("doc_requests").update(current).eq("id", requestId);

    if (!error) return { ok: true as const };

    const msg = error.message || "";
    const missingCol = getMissingColumnFromError(msg);

    if (missingCol && missingCol in current) {
      delete current[missingCol];
      continue;
    }

    return { ok: false as const, error };
  }

  return {
    ok: false as const,
    error: { message: "Update failed after retries" },
  };
}

async function resilientSelectSubmittedRequest(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  userId: string
) {
  // Try richer select first; fall back if request_code (or other columns) are missing
  const selectAttempts = [
    "id,user_id,status,service_type,request_code,submitted_at",
    "id,user_id,status,service_type,submitted_at",
    "id,user_id,status,service_type",
  ];

  for (const columns of selectAttempts) {
    const { data, error } = await supabase
      .from("doc_requests")
      .select(columns)
      .eq("id", requestId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data) return { ok: true as const, data };

    const msg = error?.message || "";
    const missingCol = getMissingColumnFromError(msg);
    if (missingCol) continue;

    if (error) return { ok: false as const, error };
  }

  return { ok: false as const, error: { message: "Request not found" } };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || body?.id || "").trim();

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    // Verify ownership + read current values (minimal stable select)
    const { data: row, error: rowErr } = await supabase
      .from("doc_requests")
      .select("id,user_id,status,service_type")
      .eq("id", requestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (rowErr || !row) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const rawService = firstString(
      body?.service_type,
      body?.serviceType,
      body?.service,
      body?.category,
      body?.requestType,
      (row as any)?.service_type
    );

    const serviceType = normalizeServiceType(rawService);

    if (!serviceType) {
      return NextResponse.json(
        { error: "Please select a valid Docs service type before submitting." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // Build a wide payload; resilient updater strips unknown columns automatically
    const updatePayload: Record<string, any> = {
      status: "submitted",
      service_type: serviceType,
      updated_at: now,
      submitted_at: now,

      // Optional mirrors / labels (only if schema supports them)
      service_label: firstString(body?.serviceLabel, rawService),

      title: firstString(body?.title, body?.requestTitle),
      description: firstString(body?.description, body?.notes, body?.details),

      delivery_method: firstString(body?.delivery_method, body?.deliveryMethod),
      phone: firstString(body?.phone, body?.contactPhone),

      // Optional JSON snapshots
      intake_payload: body,
      request_payload: body,
      form_payload: body,
    };

    for (const k of Object.keys(updatePayload)) {
      if (updatePayload[k] === undefined || updatePayload[k] === null) {
        delete updatePayload[k];
      }
    }

    const updated = await resilientUpdateDocRequest(supabase, requestId, updatePayload);

    if (!updated.ok) {
      const msg = (updated as any)?.error?.message || "Failed to submit request";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Audit event (non-blocking)
    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "request_submitted",
      event_payload: { service_type: serviceType, submitted_at: now },
    });

    // Re-read request (best effort) so client gets consistent response
    const finalRead = await resilientSelectSubmittedRequest(supabase, requestId, user.id);

    if (!finalRead.ok) {
      return NextResponse.json({
        ok: true,
        requestId,
        request: {
          id: requestId,
          status: "submitted",
          service_type: serviceType,
          request_code: null,
          submitted_at: now,
        },
      });
    }

    const finalRow: any = finalRead.data;

    return NextResponse.json({
      ok: true,
      requestId,
      request: {
        id: finalRow.id,
        status: finalRow.status || "submitted",
        service_type: finalRow.service_type || serviceType,
        request_code: finalRow.request_code ?? null,
        submitted_at: finalRow.submitted_at ?? now,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
