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

function parseSupabaseStorageUrl(u: string): { bucket: string; path: string } | null {
  if (!u || typeof u !== "string") return null;
  if (!u.startsWith("supabase://")) return null;
  const rest = u.replace("supabase://", "");
  const i = rest.indexOf("/");
  if (i <= 0) return null;
  const bucket = rest.slice(0, i);
  const path = rest.slice(i + 1);
  if (!bucket || !path) return null;
  return { bucket, path };
}

function resolveFileRef(row: any): { bucket: string; path: string } | null {
  if (row?.storage_bucket && row?.storage_path) {
    return { bucket: String(row.storage_bucket), path: String(row.storage_path) };
  }
  if (row?.bucket && row?.path) {
    return { bucket: String(row.bucket), path: String(row.path) };
  }
  if (row?.storage_path) {
    return { bucket: "docs-files", path: String(row.storage_path) };
  }
  if (row?.file_path) {
    return { bucket: "docs-files", path: String(row.file_path) };
  }

  const maybe = row?.file_url || row?.storage_url || row?.url || null;
  if (typeof maybe === "string") return parseSupabaseStorageUrl(maybe);

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const url = new URL(req.url);
    const requestId = url.searchParams.get("requestId") || "";
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const { data: requestRow, error: reqErr } = await supabase
      .from("doc_requests")
      .select("*")
      .eq("id", requestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reqErr || !requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const { data: filesRaw } = await supabase
      .from("doc_request_files")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    const files = await Promise.all(
      (filesRaw || []).map(async (f: any, idx: number) => {
        const ref = resolveFileRef(f);
        let signed_url: string | null = null;

        if (ref) {
          const { data: signed } = await supabase.storage
            .from(ref.bucket)
            .createSignedUrl(ref.path, 60 * 15);

          signed_url = signed?.signedUrl || null;
        }

        return {
          ...f,
          display_name:
            f.file_name || f.original_name || f.name || f.filename || `File ${idx + 1}`,
          signed_url,
        };
      })
    );

    const { data: eventsRaw } = await supabase
      .from("doc_request_events")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    return NextResponse.json({
      request: requestRow,
      files,
      events: eventsRaw || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}