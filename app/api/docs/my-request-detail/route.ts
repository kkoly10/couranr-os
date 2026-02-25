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

function getMissingColumnFromError(msg: string): string | null {
  if (!msg) return null;

  let m = msg.match(/Could not find the '([^']+)' column/i);
  if (m?.[1]) return m[1];

  m = msg.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i);
  if (m?.[1]) return m[1];

  return null;
}

async function safeSelectDocRequest(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  userId: string
) {
  const candidates = [
    "id,user_id,status,service_type,title,description,delivery_method,phone,request_code,paid,quoted_total_cents,created_at,updated_at",
    "id,user_id,status,service_type,title,description,delivery_method,phone,request_code,created_at,updated_at",
    "id,user_id,status,service_type,title,description,delivery_method,phone,created_at,updated_at",
    "id,user_id,status,service_type,title,created_at,updated_at",
    "*",
  ];

  for (const sel of candidates) {
    const { data, error } = await supabase
      .from("doc_requests")
      .select(sel)
      .eq("id", requestId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data) {
      return {
        ok: true as const,
        data: {
          ...data,
          request_code: (data as any).request_code ?? null,
          paid: (data as any).paid ?? false,
          quoted_total_cents: (data as any).quoted_total_cents ?? null,
          description: (data as any).description ?? null,
          delivery_method: (data as any).delivery_method ?? null,
          phone: (data as any).phone ?? null,
          title: (data as any).title ?? "Docs Request",
        },
      };
    }

    const msg = error?.message || "";
    if (/Could not find the '.*' column/i.test(msg) || /column .* does not exist/i.test(msg)) {
      continue;
    }

    return { ok: false as const, error };
  }

  return { ok: false as const, error: { message: "Could not load request" } };
}

async function safeSelectDocFiles(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  userId: string
) {
  const candidates = [
    "id,request_id,user_id,file_name,mime_type,size_bytes,storage_bucket,storage_path,created_at",
    "id,request_id,user_id,file_name,mime_type,size_bytes,storage_path,created_at",
    "*",
  ];

  for (const sel of candidates) {
    const { data, error } = await supabase
      .from("doc_request_files")
      .select(sel)
      .eq("request_id", requestId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (!error) return { ok: true as const, data: data || [] };

    const msg = error?.message || "";
    const missing = getMissingColumnFromError(msg);
    if (missing || /column .* does not exist/i.test(msg)) continue;

    return { ok: false as const, error };
  }

  return { ok: false as const, error: { message: "Could not load files" } };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const { searchParams } = new URL(req.url);
    const requestId = String(searchParams.get("requestId") || "").trim();

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const reqRow = await safeSelectDocRequest(supabase, requestId, user.id);
    if (!reqRow.ok || !reqRow.data) {
      return NextResponse.json({ error: reqRow.error?.message || "Request not found" }, { status: 404 });
    }

    const fileRows = await safeSelectDocFiles(supabase, requestId, user.id);
    if (!fileRows.ok) {
      return NextResponse.json({ error: fileRows.error?.message || "Failed to load files" }, { status: 400 });
    }

    const files = await Promise.all(
      (fileRows.data || []).map(async (f: any) => {
        const bucket = f.storage_bucket || "docs-files";
        const path = f.storage_path || null;

        let signed_url: string | null = null;
        if (path) {
          const { data: signed } = await supabase.storage
            .from(bucket)
            .createSignedUrl(path, 60 * 30);
          signed_url = signed?.signedUrl || null;
        }

        return {
          id: f.id,
          request_id: f.request_id,
          user_id: f.user_id,
          file_name: f.file_name || "file",
          display_name: f.file_name || "file",
          mime_type: f.mime_type || "application/octet-stream",
          size_bytes: f.size_bytes ?? null,
          storage_bucket: bucket,
          storage_path: path,
          created_at: f.created_at ?? null,
          signed_url,
        };
      })
    );

    return NextResponse.json({
      ok: true,
      request: reqRow.data,
      files,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
