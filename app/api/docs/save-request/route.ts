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

  if (
    raw === "print_scan_delivery" ||
    raw === "data_entry" ||
    raw === "dmv_prep" ||
    raw === "immigration_clerical" ||
    raw === "resume_typing"
  ) {
    return raw;
  }

  const map: Record<string, string> = {
    print: "print_scan_delivery",
    printing: "print_scan_delivery",
    print_delivery: "print_scan_delivery",
    print_scan: "print_scan_delivery",
    print_scan_and_delivery: "print_scan_delivery",
    scan: "print_scan_delivery",

    dataentry: "data_entry",
    business_data_entry: "data_entry",
    clerical_data_entry: "data_entry",

    dmv: "dmv_prep",
    dmv_guidance: "dmv_prep",
    dmv_doc_prep: "dmv_prep",
    dmv_document_prep: "dmv_prep",

    immigration: "immigration_clerical",
    immigration_prep: "immigration_clerical",
    immigration_doc_help: "immigration_clerical",
    immigration_document_assistance: "immigration_clerical",

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

  for (let i = 0; i < 30; i++) {
    // If all optional fields were stripped, treat as no-op success
    if (Object.keys(current).length === 0) {
      return { ok: true as const };
    }

    const { error } = await supabase
      .from("doc_requests")
      .update(current)
      .eq("id", requestId);

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

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || body?.id || "");

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    // Verify ownership
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
      body?.serviceType,
      body?.service_type,
      body?.service,
      body?.category
    );

    const serviceType = normalizeServiceType(rawService);
    const now = new Date().toISOString();

    const updatePayload: Record<string, any> = {
      updated_at: now,

      ...(serviceType ? { service_type: serviceType } : {}),
      ...(rawService ? { service_label: rawService } : {}),

      title: firstString(body?.title, body?.requestTitle),
      customer_name: firstString(body?.fullName, body?.name, body?.customerName),
      customer_email: firstString(body?.email, body?.customerEmail),
      customer_phone: firstString(body?.phone, body?.customerPhone),

      // Common docs request fields (kept optional)
      due_date: firstString(body?.dueDate, body?.neededBy),
      delivery_address: firstString(body?.deliveryAddress),
      pickup_address: firstString(body?.pickupAddress),
      city: firstString(body?.city),
      notes: firstString(body?.notes, body?.instructions, body?.description),

      // Whole intake snapshot (stripped if your schema doesn't have these)
      intake_payload: body,
      request_payload: body,
      form_payload: body,
    };

    for (const k of Object.keys(updatePayload)) {
      if (updatePayload[k] === undefined) delete updatePayload[k];
      if (updatePayload[k] === null) delete updatePayload[k];
    }

    const updated = await resilientUpdateDocRequest(supabase, requestId, updatePayload);

    if (!updated.ok) {
      const msg = updated.error?.message || "Failed to save request";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Optional audit event (non-blocking)
    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "request_saved",
      event_payload: {
        service_type: serviceType ?? (row as any)?.service_type ?? null,
        has_payload: true,
      },
    });

    return NextResponse.json({
      ok: true,
      requestId,
      service_type: serviceType ?? (row as any)?.service_type ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
