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

  // Canonical values (already valid)
  if (
    raw === "print_scan_delivery" ||
    raw === "data_entry" ||
    raw === "dmv_prep" ||
    raw === "immigration_clerical" ||
    raw === "resume_typing"
  ) {
    return raw;
  }

  // Friendly aliases -> canonical
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

  // PostgREST schema cache errors
  let m = msg.match(/Could not find the '([^']+)' column/i);
  if (m?.[1]) return m[1];

  // Postgres column errors
  m = msg.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i);
  if (m?.[1]) return m[1];

  return null;
}

async function resilientInsertDocRequest(
  supabase: ReturnType<typeof svc>,
  payload: Record<string, any>
) {
  const current = { ...payload };

  for (let i = 0; i < 30; i++) {
    const { data, error } = await supabase
      .from("doc_requests")
      .insert(current)
      .select("id")
      .single();

    if (!error && data?.id) {
      return { ok: true as const, id: data.id as string };
    }

    const msg = error?.message || "";
    const missingCol = getMissingColumnFromError(msg);

    if (missingCol && missingCol in current) {
      delete current[missingCol];
      continue;
    }

    return { ok: false as const, error };
  }

  return {
    ok: false as const,
    error: { message: "Insert failed after retries" },
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const body = await req.json().catch(() => ({}));

    const rawService = firstString(
      body?.serviceType,
      body?.service_type,
      body?.service,
      body?.category
    );

    const serviceType = normalizeServiceType(rawService);
    const now = new Date().toISOString();

    // Build a rich payload, then auto-strip unknown columns if your schema differs
    const payload: Record<string, any> = {
      user_id: user.id,
      status: "draft",
      updated_at: now,
      created_at: now,

      ...(serviceType ? { service_type: serviceType } : {}),
      ...(rawService ? { service_label: rawService } : {}),

      // Common fields (safe to attempt; stripped if missing)
      title: firstString(body?.title, body?.requestTitle),
      customer_name: firstString(body?.fullName, body?.name, body?.customerName),
      customer_email: firstString(body?.email, body?.customerEmail),
      customer_phone: firstString(body?.phone, body?.customerPhone),
      notes: firstString(body?.notes, body?.instructions, body?.description),

      // Keep entire intake in a JSON column if you have one (stripped if not)
      intake_payload: body,
      request_payload: body,
      form_payload: body,
    };

    // Remove undefined/null so we don't send junk
    for (const k of Object.keys(payload)) {
      if (payload[k] === undefined) delete payload[k];
      if (payload[k] === null) delete payload[k];
    }

    const inserted = await resilientInsertDocRequest(supabase, payload);

    if (!inserted.ok) {
      const msg = inserted.error?.message || "Failed to create draft";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Optional audit event (non-blocking)
    await supabase.from("doc_request_events").insert({
      request_id: inserted.id,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "draft_created",
      event_payload: {
        service_type: serviceType,
        service_label: rawService,
      },
    });

    return NextResponse.json({
      ok: true,
      requestId: inserted.id,
      service_type: serviceType,
      service_label: rawService,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}