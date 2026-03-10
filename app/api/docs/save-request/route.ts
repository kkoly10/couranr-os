export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";
import { ensureBusinessAccess, parseBusinessAccountId } from "@/lib/businessAccount";
import { DOCS_TERMS_VERSION } from "@/lib/docsTerms";

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

  const canonical = new Set([
    "print_scan_delivery",
    "data_entry",
    "dmv_prep",
    "immigration_clerical",
    "resume_typing",
  ]);

  if (canonical.has(raw)) return raw;

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

function isTrueish(v: any) {
  if (typeof v === "boolean") return v;
  const n = String(v || "").trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes" || n === "on";
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

    const { data: row, error: rowErr } = await supabase
      .from("doc_requests")
      .select("id,user_id,service_type,business_account_id")
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
      body?.category,
      row.service_type
    );

    const serviceType =
      normalizeServiceType(rawService) || row.service_type || "print_scan_delivery";

    const hasBusinessKey =
      Object.prototype.hasOwnProperty.call(body, "businessAccountId") ||
      Object.prototype.hasOwnProperty.call(body, "business_account_id");

    const rawBusinessValue = hasBusinessKey
      ? body?.businessAccountId ?? body?.business_account_id ?? null
      : undefined;

    let nextBusinessAccountId: string | null | undefined = undefined;

    if (hasBusinessKey) {
      if (rawBusinessValue === "" || rawBusinessValue === null) {
        nextBusinessAccountId = null;
      } else {
        const parsed = parseBusinessAccountId(rawBusinessValue);
        if (!parsed) {
          return NextResponse.json(
            { error: "Invalid businessAccountId" },
            { status: 400 }
          );
        }

        const access = await ensureBusinessAccess(
          supabase as any,
          user.id,
          parsed
        );

        if (!access.ok) {
          return NextResponse.json(
            { error: access.error },
            { status: access.code }
          );
        }

        nextBusinessAccountId = parsed;
      }
    }

    const now = new Date().toISOString();
    const termsAccepted = isTrueish(
      body?.docs_terms_accepted ?? body?.termsAccepted
    );
    const termsVersion =
      firstString(
        body?.docs_terms_version,
        body?.termsVersion,
        DOCS_TERMS_VERSION
      ) || DOCS_TERMS_VERSION;

    const updatePayload: Record<string, any> = {
      updated_at: now,
      service_type: serviceType,
      service_label: firstString(body?.serviceLabel, rawService),
      title: firstString(body?.title, body?.requestTitle),
      description: firstString(body?.description, body?.notes, body?.details),
      delivery_method: firstString(
        body?.deliveryMethod,
        body?.delivery_method
      ),
      phone: firstString(body?.phone, body?.contactPhone),
      intake_payload: body,
      request_payload: body,
      form_payload: body,
    };

    if (typeof nextBusinessAccountId !== "undefined") {
      updatePayload.business_account_id = nextBusinessAccountId;
    }

    if (termsAccepted) {
      updatePayload.docs_terms_accepted_at = now;
      updatePayload.docs_terms_version = termsVersion;
      updatePayload.terms_accepted_at = now;
      updatePayload.terms_version = termsVersion;
    }

    const { data: updated, error: updErr } = await supabase
      .from("doc_requests")
      .update(updatePayload)
      .eq("id", requestId)
      .eq("user_id", user.id)
      .select(
        "id,request_code,service_type,title,description,delivery_method,phone,status,paid,total_cents,amount_subtotal_cents,quoted_total_cents,final_total_cents,created_at,submitted_at,completed_at,business_account_id"
      )
      .single();

    if (updErr || !updated) {
      return NextResponse.json(
        { error: updErr?.message || "Failed to save request" },
        { status: 400 }
      );
    }

    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "request_saved",
      event_payload: {
        service_type: serviceType,
        business_account_id:
          typeof nextBusinessAccountId !== "undefined"
            ? nextBusinessAccountId
            : row.business_account_id ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      requestId,
      request: updated,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}