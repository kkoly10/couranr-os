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

    // Record file in DB
    const { data: insertedFile, error: fileErr } = await supabase
      .from("doc_request_files")
      .insert({
        request_id: requestId,
        user_id: user.id,
        file_name: file.name || safeName,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size ?? null,
        storage_bucket: DOCS_BUCKET,
        storage_path: uploadedPath,
      })
      .select("*")
      .single();

    if (fileErr || !insertedFile) {
      // Cleanup orphan storage file if DB insert fails
      if (uploadedPath) {
        await supabase.storage.from(DOCS_BUCKET).remove([uploadedPath]);
      }

      return NextResponse.json(
        { error: `Failed to record file: ${fileErr?.message || "Unknown DB error"}` },
        { status: 500 }
      );
    }

    // Audit event (non-fatal if it fails)
    const { error: eventErr } = await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "file_uploaded",
      event_payload: {
        file_name: insertedFile.file_name,
        size_bytes: insertedFile.size_bytes,
        storage_path: insertedFile.storage_path,
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