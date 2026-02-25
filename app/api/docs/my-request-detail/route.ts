// app/api/docs/my-request-detail/route.ts
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

function isRelationMissingError(message: string) {
  const m = String(message || "").toLowerCase();
  return (
    m.includes("relation") && m.includes("does not exist")
  ) || m.includes("schema cache");
}

async function loadRequestRow(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  userId: string
) {
  // Try base table first
  let q = await supabase
    .from("doc_requests")
    .select("*")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!q.error) {
    return { data: q.data, error: null };
  }

  // Fallback to view if base table alias/view is what your routes are reading
  if (isRelationMissingError(q.error.message || "")) {
    const fallback = await supabase
      .from("docs_requests")
      .select("*")
      .eq("id", requestId)
      .eq("user_id", userId)
      .maybeSingle();

    return { data: fallback.data, error: fallback.error };
  }

  return { data: null, error: q.error };
}

async function loadRequestFiles(
  supabase: ReturnType<typeof svc>,
  requestId: string
) {
  let q = await supabase
    .from("doc_request_files")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false });

  if (!q.error) {
    return { data: q.data || [], error: null };
  }

  if (isRelationMissingError(q.error.message || "")) {
    const fallback = await supabase
      .from("docs_request_files")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: false });

    return { data: fallback.data || [], error: fallback.error };
  }

  return { data: [], error: q.error };
}

function normalizeRequest(row: Record<string, any>) {
  return {
    id: row.id ?? null,
    user_id: row.user_id ?? null,

    // Core request fields
    service_type: row.service_type ?? row.request_type ?? null,
    title: row.title ?? row.request_title ?? "Docs Request",
    description: row.description ?? row.notes ?? row.details ?? null,
    delivery_method: row.delivery_method ?? row.deliveryMethod ?? null,
    phone: row.phone ?? row.contact_phone ?? row.contactPhone ?? null,

    // Status / quote info (with safe defaults)
    status: row.status ?? "draft",
    request_code: row.request_code ?? null,
    paid: typeof row.paid === "boolean" ? row.paid : false,
    quoted_total_cents:
      typeof row.quoted_total_cents === "number" ? row.quoted_total_cents : null,

    // Timestamps
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    submitted_at: row.submitted_at ?? null,
    completed_at: row.completed_at ?? null,
  };
}

async function addSignedUrls(
  supabase: ReturnType<typeof svc>,
  files: Record<string, any>[]
) {
  const out: Record<string, any>[] = [];

  for (const f of files || []) {
    const bucket =
      f.storage_bucket ||
      f.bucket ||
      "docs-files";

    const path =
      f.storage_path ||
      f.path ||
      null;

    let signed_url: string | null = null;

    if (bucket && path) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60); // 1 hour

      if (!error) {
        signed_url = data?.signedUrl ?? null;
      }
    }

    out.push({
      id: f.id ?? null,
      request_id: f.request_id ?? null,
      file_name: f.file_name ?? f.filename ?? null,
      display_name: f.display_name ?? f.file_name ?? f.filename ?? null,
      mime_type: f.mime_type ?? f.content_type ?? null,
      size_bytes: f.size_bytes ?? f.file_size ?? null,
      storage_bucket: bucket,
      storage_path: path,
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

    const { data: requestData, error: requestErr } = await loadRequestRow(
      supabase,
      requestId,
      user.id
    );

    if (requestErr) {
      return NextResponse.json(
        { error: requestErr.message || "Failed to load request" },
        { status: 500 }
      );
    }

    if (!requestData) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    // ✅ Fixes your TypeScript spread issue by forcing object shape
    const requestRow =
      requestData && typeof requestData === "object"
        ? (requestData as Record<string, any>)
        : ({} as Record<string, any>);

    const { data: fileRows, error: filesErr } = await loadRequestFiles(
      supabase,
      requestId
    );

    if (filesErr) {
      return NextResponse.json(
        { error: filesErr.message || "Failed to load request files" },
        { status: 500 }
      );
    }

    const files = await addSignedUrls(
      supabase,
      (Array.isArray(fileRows) ? fileRows : []) as Record<string, any>[]
    );

    return NextResponse.json({
      ok: true,
      request: normalizeRequest(requestRow),
      files,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}