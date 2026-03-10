export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";
import { ensureBusinessAccess, parseBusinessAccountId } from "@/lib/businessAccount";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

const ALLOWED_SERVICE_TYPES = new Set([
  "print_scan_delivery",
  "data_entry",
  "dmv_prep",
  "immigration_clerical",
  "resume_typing",
]);

function normalizeServiceType(input: any): string {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (ALLOWED_SERVICE_TYPES.has(raw)) return raw;

  const map: Record<string, string> = {
    print: "print_scan_delivery",
    printing: "print_scan_delivery",
    print_scan: "print_scan_delivery",
    print_scan_and_delivery: "print_scan_delivery",
    print_delivery: "print_scan_delivery",
    scan: "print_scan_delivery",

    dataentry: "data_entry",
    data_entry_help: "data_entry",
    clerical_data_entry: "data_entry",

    dmv: "dmv_prep",
    dmv_guidance: "dmv_prep",
    dmv_docs: "dmv_prep",
    dmv_prep_help: "dmv_prep",

    immigration: "immigration_clerical",
    immigration_prep: "immigration_clerical",
    immigration_docs: "immigration_clerical",
    immigration_assistance: "immigration_clerical",

    resume: "resume_typing",
    resume_review: "resume_typing",
    resume_typing_help: "resume_typing",
    typing: "resume_typing",
  };

  return map[raw] || "print_scan_delivery";
}

function makeRequestCode() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `DOC${Date.now().toString().slice(-6)}${rand}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();
    const body = await req.json().catch(() => ({}));

    const serviceType = normalizeServiceType(
      body?.service_type ?? body?.serviceType ?? body?.type ?? body?.category
    );

    const requestCode =
      String(body?.request_code ?? body?.requestCode ?? "").trim() ||
      makeRequestCode();

    const requestedBusinessAccountId = parseBusinessAccountId(
      body?.businessAccountId ?? body?.business_account_id
    );

    if (
      (body?.businessAccountId || body?.business_account_id) &&
      !requestedBusinessAccountId
    ) {
      return NextResponse.json(
        { error: "Invalid businessAccountId" },
        { status: 400 }
      );
    }

    if (requestedBusinessAccountId) {
      const access = await ensureBusinessAccess(
        supabase as any,
        user.id,
        requestedBusinessAccountId
      );
      if (!access.ok) {
        return NextResponse.json(
          { error: access.error },
          { status: access.code }
        );
      }
    }

    const { data: requestRow, error } = await supabase
      .from("doc_requests")
      .insert({
        user_id: user.id,
        business_account_id: requestedBusinessAccountId ?? null,
        status: "draft",
        service_type: serviceType,
        paid: false,
        request_code: requestCode,
        intake_payload: body ?? {},
        request_payload: body ?? {},
        form_payload: body ?? {},
      })
      .select(
        "id,user_id,business_account_id,request_code,service_type,title,description,delivery_method,phone,status,paid,total_cents,amount_subtotal_cents,quoted_total_cents,final_total_cents,created_at,submitted_at,completed_at"
      )
      .single();

    if (error || !requestRow) {
      return NextResponse.json(
        { error: error?.message || "Failed to create draft" },
        { status: 500 }
      );
    }

    await supabase.from("doc_request_events").insert({
      request_id: requestRow.id,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "draft_created",
      event_payload: {
        service_type: serviceType,
        request_code: requestCode,
        business_account_id: requestedBusinessAccountId ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      requestId: requestRow.id,
      request: requestRow,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}