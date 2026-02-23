// app/api/admin/docs/requests/[requestId]/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/app/lib/auth";

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
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  if (!bucket || !path) return null;
  return { bucket, path };
}

function resolveFileRef(row: any): { bucket: string; path: string } | null {
  // Common patterns
  if (row?.storage_bucket && row?.storage_path) {
    return { bucket: String(row.storage_bucket), path: String(row.storage_path) };
  }
  if (row?.bucket && row?.path) {
    return { bucket: String(row.bucket), path: String(row.path) };
  }
  if (row?.bucket && row?.storage_path) {
    return { bucket: String(row.bucket), path: String(row.storage_path) };
  }
  if (row?.storage_path) {
    return { bucket: "docs-files", path: String(row.storage_path) };
  }
  if (row?.file_path) {
    return { bucket: "docs-files", path: String(row.file_path) };
  }

  const maybeUrl =
    row?.file_url ||
    row?.storage_url ||
    row?.url ||
    row?.document_url ||
    row?.object_url ||
    null;

  if (typeof maybeUrl === "string") {
    const parsed = parseSupabaseStorageUrl(maybeUrl);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeFileName(row: any, idx: number) {
  return (
    row?.file_name ||
    row?.original_name ||
    row?.name ||
    row?.filename ||
    `file-${idx + 1}`
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  try {
    await requireAdmin(req);

    const requestId = String(params?.requestId || "");
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const supabase = svc();

    const { data: requestRow, error: reqErr } = await supabase
      .from("doc_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (reqErr || !requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    let customerProfile: any = null;
    if ((requestRow as any)?.user_id) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, email, role")
        .eq("id", (requestRow as any).user_id)
        .maybeSingle();
      customerProfile = prof || null;
    }

    const { data: filesRaw } = await supabase
      .from("doc_request_files")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    const files = await Promise.all(
      (filesRaw || []).map(async (f: any, idx: number) => {
        const ref = resolveFileRef(f);

        let signedUrl: string | null = null;
        let directUrl: string | null = null;

        // If file row already stores a normal URL, keep it
        const maybeHttpUrl =
          f?.file_url ||
          f?.url ||
          f?.public_url ||
          f?.download_url ||
          null;

        if (typeof maybeHttpUrl === "string" && /^https?:\/\//i.test(maybeHttpUrl)) {
          directUrl = maybeHttpUrl;
        }

        if (ref) {
          const { data: signed, error: signErr } = await supabase.storage
            .from(ref.bucket)
            .createSignedUrl(ref.path, 60 * 15);

          if (!signErr) {
            signedUrl = signed?.signedUrl || null;
          }
        }

        return {
          ...f,
          display_name: normalizeFileName(f, idx),
          signed_url: signedUrl,
          direct_url: directUrl,
          resolved_bucket: ref?.bucket || null,
          resolved_path: ref?.path || null,
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
      customer: customerProfile,
      files,
      events: eventsRaw || [],
    });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      msg.includes("Missing authorization") || msg.includes("Invalid or expired token")
        ? 401
        : msg.includes("Admin access required")
        ? 403
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}
