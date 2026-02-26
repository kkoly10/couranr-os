// app/api/docs/upload-file/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

const DOCS_BUCKET = "docs-files";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function cleanName(name: string) {
  return (name || "file")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

async function ensureDocsBucket(supabase: ReturnType<typeof svc>) {
  // Try to read bucket first
  const { data: bucket, error: getErr } = await supabase.storage.getBucket(DOCS_BUCKET);

  // If it exists, we're good
  if (bucket && !getErr) return;

  // If not found, create it (service-role only)
  const { error: createErr } = await supabase.storage.createBucket(DOCS_BUCKET, {
    public: false,
    fileSizeLimit: "25MB",
  });

  // If another request created it at the same time, that's okay
  if (
    createErr &&
    !String(createErr.message || "").toLowerCase().includes("already exists")
  ) {
    throw new Error(`Storage bucket error: ${createErr.message || "Could not create docs bucket"}`);
  }
}

// ✅ NEW: Helper to extract missing column from Supabase error message
function getMissingColumnFromError(msg: string): string | null {
  if (!msg) return null;
  let m = msg.match(/Could not find the '([^']+)' column/i);
  if (m?.[1]) return m[1];
  m = msg.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i);
  if (m?.[1]) return m[1];
  return null;
}

// ✅ NEW: Self-Healing database insertion logic
async function resilientInsertFile(
  supabase: ReturnType<typeof svc>,
  basePayload: Record<string, any>
) {
  const current = { ...basePayload };

  for (let i = 0; i < 15; i++) {
    const { data, error } = await supabase
      .from("doc_request_files")
      .insert(current)
      .select("*")
      .single();

    if (!error) return { ok: true, data };

    const msg = error.message || "";
    const missingCol = getMissingColumnFromError(msg);

    if (missingCol) {
      // Smart fallbacks to match common Supabase schema variations
      if (missingCol === "file_name") {
        current.filename = current.file_name;
        delete current.file_name;
      } else if (missingCol === "mime_type") {
        current.content_type = current.mime_type;
        delete current.mime_type;
      } else if (missingCol === "size_bytes") {
        current.file_size = current.size_bytes;
        delete current.size_bytes;
      } else if (missingCol === "storage_bucket") {
        current.bucket = current.storage_bucket;
        delete current.storage_bucket;
      } else if (missingCol === "storage_path") {
        current.path = current.storage_path;
        delete current.storage_path;
      } else {
        // If unknown, strip it to prevent crashing
        delete current[missingCol];
      }
      continue;
    }

    // Completely unrecoverable error
    return { ok: false, error };
  }

  return { ok: false, error: { message: "Failed to resolve schema columns after retries." } };
}

export async function POST(req: NextRequest) {
  let uploadedPath: string | null = null;

  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    // Ensure storage bucket exists
    await ensureDocsBucket(supabase);

    const fd = await req.formData();
    const requestId = String(fd.get("requestId") || "");
    const file = fd.get("file") as File | null;

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    // Verify ownership of the docs request
    const { data: requestRow, error: reqErr } = await supabase
      .from("doc_requests")
      .select("id,user_id,status")
      .eq("id", requestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reqErr) {
      return NextResponse.json(
        { error: `Request lookup failed: ${reqErr.message}` },
        { status: 500 }
      );
    }

    if (!requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const bytes = await file.arrayBuffer();
    const safeName = cleanName(file.name || "file");

    uploadedPath = `${user.id}/${requestId}/${Date.now()}-${Math.floor(
      1000 + Math.random() * 9000
    )}-${safeName}`;

    // Upload to Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from(DOCS_BUCKET)
      .upload(uploadedPath, new Uint8Array(bytes), {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadErr.message || "Upload failed"}` },
        { status: 500 }
      );
    }

    // ✅ FIXED: Record file in DB using resilient self-healing logic
    const filePayload = {
      request_id: requestId,
      user_id: user.id,
      file_name: file.name || safeName,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size ?? null,
      storage_bucket: DOCS_BUCKET,
      storage_path: uploadedPath,
    };

    const insertResult = await resilientInsertFile(supabase, filePayload);

    if (!insertResult.ok || !insertResult.data) {
      // Cleanup orphan storage file if DB insert fails entirely
      if (uploadedPath) {
        await supabase.storage.from(DOCS_BUCKET).remove([uploadedPath]);
      }

      return NextResponse.json(
        { error: `Failed to record file: ${insertResult.error?.message || "Unknown DB error"}` },
        { status: 500 }
      );
    }

    const insertedFile = insertResult.data;

    // Audit event (non-fatal if it fails)
    const { error: eventErr } = await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "file_uploaded",
      event_payload: {
        // Fallbacks used here safely in case the column names shifted
        file_name: insertedFile.file_name || insertedFile.filename || safeName,
        size_bytes: insertedFile.size_bytes || insertedFile.file_size || file.size,
        storage_path: insertedFile.storage_path || insertedFile.path || uploadedPath,
      },
    });

    if (eventErr) {
      // Do not fail the upload if audit insert fails
      console.error("doc_request_events insert failed:", eventErr.message);
    }

    return NextResponse.json({ ok: true, file: insertedFile });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
