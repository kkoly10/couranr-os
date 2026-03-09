export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";
import { DOCS_TERMS_VERSION } from "@/lib/docsTerms";
import { ensureBusinessAccess, parseBusinessAccountId } from "@/lib/businessAccount";

type SchemaFallbackTelemetry = {
  updateMissingColumns: string[];
  updateAttemptCount: number;
  selectFallbackLevel: number;
};

function envTrue(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

const STRICT_SCHEMA_FALLBACK = envTrue(process.env.DOCS_SCHEMA_FALLBACK_STRICT);

function schemaFallbackUsed(telemetry: SchemaFallbackTelemetry) {
  return telemetry.updateMissingColumns.length > 0 || telemetry.selectFallbackLevel > 1;
}

function logSchemaFallback(
  context: string,
  telemetry: SchemaFallbackTelemetry,
  extra?: Record<string, any>
) {
  const used = schemaFallbackUsed(telemetry);
  if (!used) return;

  console.warn("docs schema fallback used", {
    context,
    update_missing_columns: telemetry.updateMissingColumns,
    update_attempt_count: telemetry.updateAttemptCount,
    select_fallback_level: telemetry.selectFallbackLevel,
    ...(extra || {}),
  });
}

async function persistSchemaFallbackEvent(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  userId: string,
  telemetry: SchemaFallbackTelemetry,
  context: string
) {
  if (!schemaFallbackUsed(telemetry)) return;

  try {
    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: userId,
      actor_role: "system",
      event_type: "schema_fallback_used",
      event_payload: {
        context,
        update_missing_columns: telemetry.updateMissingColumns,
        update_attempt_count: telemetry.updateAttemptCount,
        select_fallback_level: telemetry.selectFallbackLevel,
      },
    });
  } catch {
    // best-effort telemetry persistence
  }
}

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
    scan_email: "print_scan_delivery",
    printing_delivery: "print_scan_delivery",
    printing_pickup: "print_scan_delivery",

    dataentry: "data_entry",
    business_data_entry: "data_entry",
    clerical_data_entry: "data_entry",
    general_admin_help: "data_entry",
    general_typing: "data_entry",

    dmv: "dmv_prep",
    dmv_guidance: "dmv_prep",
    dmv_doc_prep: "dmv_prep",
    dmv_document_prep: "dmv_prep",
    dmv_doc_help: "dmv_prep",
    dmv_prep_admin: "dmv_prep",

    immigration: "immigration_clerical",
    immigration_prep: "immigration_clerical",
    immigration_doc_help: "immigration_clerical",
    immigration_document_assistance: "immigration_clerical",
    immigration_prep_help: "immigration_clerical",
    immigration_prep_admin: "immigration_clerical",

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
  payload: Record<string, any>,
  telemetry: SchemaFallbackTelemetry
) {
  const current = { ...payload };

  for (let i = 0; i < 40; i++) {
    telemetry.updateAttemptCount = i + 1;

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
      if (!telemetry.updateMissingColumns.includes(missingCol)) {
        telemetry.updateMissingColumns.push(missingCol);
      }
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
  userId: string,
  telemetry: SchemaFallbackTelemetry
) {
  const selectAttempts = [
    "id,user_id,status,service_type,request_code,submitted_at",
    "id,user_id,status,service_type,submitted_at",
    "id,user_id,status,service_type",
  ];

  for (let idx = 0; idx < selectAttempts.length; idx++) {
    const columns = selectAttempts[idx];
    telemetry.selectFallbackLevel = idx + 1;

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

    const schemaTelemetry: SchemaFallbackTelemetry = {
      updateMissingColumns: [],
      updateAttemptCount: 0,
      selectFallbackLevel: 0,
    };

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

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

    const termsAccepted = isTrueish(body?.docs_terms_accepted ?? body?.termsAccepted);
    if (!termsAccepted) {
      return NextResponse.json(
        { error: "Please accept the Docs Service Terms before submitting." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const termsVersion =
      firstString(
        body?.docs_terms_version,
        body?.termsVersion,
        DOCS_TERMS_VERSION
      ) || DOCS_TERMS_VERSION;

    const rawBusinessAccountId = firstString(
      body?.business_account_id,
      body?.businessAccountId,
      body?.businessId
    );
    const businessAccountId = parseBusinessAccountId(rawBusinessAccountId);

    if (rawBusinessAccountId && !businessAccountId) {
      return NextResponse.json({ error: "Invalid business account id." }, { status: 400 });
    }

    if (businessAccountId) {
      const access = await ensureBusinessAccess(
        supabase as any,
        user.id,
        businessAccountId
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.code });
      }
    }

    const updatePayload: Record<string, any> = {
      status: "submitted",
      service_type: serviceType,
      updated_at: now,
      submitted_at: now,
      service_label: firstString(body?.serviceLabel, rawService),
      title: firstString(body?.title, body?.requestTitle),
      description: firstString(body?.description, body?.notes, body?.details),
      delivery_method: firstString(body?.delivery_method, body?.deliveryMethod),
      phone: firstString(body?.phone, body?.contactPhone),
      intake_payload: body,
      request_payload: body,
      form_payload: body,
      business_account_id: businessAccountId,

      docs_terms_accepted_at: now,
      docs_terms_version: termsVersion,
      terms_accepted_at: now,
      terms_version: termsVersion,
    };

    for (const k of Object.keys(updatePayload)) {
      if (updatePayload[k] === undefined || updatePayload[k] === null) {
        delete updatePayload[k];
      }
    }

    const updated = await resilientUpdateDocRequest(
      supabase,
      requestId,
      updatePayload,
      schemaTelemetry
    );

    if (!updated.ok) {
      logSchemaFallback("submit_request_failed_update", schemaTelemetry, {
        request_id: requestId,
        user_id: user.id,
      });
      await persistSchemaFallbackEvent(
        supabase,
        requestId,
        user.id,
        schemaTelemetry,
        "submit_request_failed_update"
      );
      const msg = (updated as any)?.error?.message || "Failed to submit request";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "request_submitted",
      event_payload: {
        service_type: serviceType,
        submitted_at: now,
        terms_version: termsVersion,
        business_account_id: businessAccountId,
      },
    });

    const finalRead = await resilientSelectSubmittedRequest(
      supabase,
      requestId,
      user.id,
      schemaTelemetry
    );

    if (schemaFallbackUsed(schemaTelemetry) && STRICT_SCHEMA_FALLBACK) {
      logSchemaFallback("submit_request_strict_block", schemaTelemetry, {
        request_id: requestId,
        user_id: user.id,
      });
      await persistSchemaFallbackEvent(
        supabase,
        requestId,
        user.id,
        schemaTelemetry,
        "submit_request_strict_block"
      );
      return NextResponse.json(
        { error: "Schema fallback was triggered while strict mode is enabled. Apply migrations and retry." },
        { status: 500 }
      );
    }

    if (!finalRead.ok) {
      logSchemaFallback("submit_request_failed_select", schemaTelemetry, {
        request_id: requestId,
        user_id: user.id,
      });
      await persistSchemaFallbackEvent(
        supabase,
        requestId,
        user.id,
        schemaTelemetry,
        "submit_request_failed_select"
      );

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

    logSchemaFallback("submit_request", schemaTelemetry, {
      request_id: requestId,
      user_id: user.id,
    });
    await persistSchemaFallbackEvent(
      supabase,
      requestId,
      user.id,
      schemaTelemetry,
      "submit_request"
    );

    const finalRow: any = finalRead.data;
    const exposeSchemaFallback = process.env.NODE_ENV !== "production";

    const finalRow: any = finalRead.data;
    const exposeSchemaFallback = process.env.NODE_ENV !== "production";
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
      ...(exposeSchemaFallback
        ? {
            schema_fallback: {
              update_missing_columns: schemaTelemetry.updateMissingColumns,
              select_fallback_level: schemaTelemetry.selectFallbackLevel,
            },
          }
        : {}),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}