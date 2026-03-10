export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

const DOCS_BUCKET = "docs-files";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

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
  const { data: bucket, error: getErr } = await supabase.storage.getBucket(
    DOCS_BUCKET
  );
  if (bucket && !getErr) return;

  const { error: createErr } = await supabase.storage.createBucket(
    DOCS_BUCKET,
    {
      public: false,
      fileSizeLimit: "25MB",
    }
  );

  if (
    createErr &&
    !String(createErr.message || "").toLowerCase().includes("already exists")
  ) {
    throw new Error(
      `Storage bucket error: ${createErr.message || "Could not create docs bucket"}`
    );
  }
}

export async function POST(req: NextRequest) {
  let uploadedPath: string | null = null;

  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    await ensureDocsBucket(supabase);

    const fd = await req.formData();
    const requestId = String(fd.get("requestId") || "").trim();
    const file = fd.get("file") as File | null;

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if ((file.size || 0) > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File exceeds 25MB limit" },
        { status: 400 }
      );
    }

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

    const { error: uploadErr } = await supabase.storage
      .from(DOCS_BUCKET)
      .upload(uploadedPath, new Uint8Array(bytes), {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        {
          error: `Storage upload failed: ${uploadErr.message || "Upload failed"}`,
        },
        { status: 500 }
      );
    }

    const storageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/${DOCS_BUCKET}/${uploadedPath}`;

    const { data: insertedFile, error: insertErr } = await supabase
      .from("doc_request_files")
      .insert({
        request_id: requestId,
        user_id: user.id,
        file_name: file.name || safeName,
        display_name: file.name || safeName,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size ?? null,
        storage_bucket: DOCS_BUCKET,
        storage_path: uploadedPath,
        storage_url: storageUrl,
        file_role: "customer_upload",
      })
      .select(
        "id,request_id,user_id,file_name,display_name,mime_type,size_bytes,storage_bucket,storage_path,storage_url,file_role,created_at"
      )
      .single();

    if (insertErr || !insertedFile) {
      if (uploadedPath) {
        await supabase.storage.from(DOCS_BUCKET).remove([uploadedPath]);
      }

      return NextResponse.json(
        { error: insertErr?.message || "Failed to record file" },
        { status: 500 }
      );
    }

    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "file_uploaded",
      event_payload: {
        file_name: insertedFile.file_name,
        size_bytes: insertedFile.size_bytes,
        storage_path: insertedFile.storage_path,
        storage_bucket: insertedFile.storage_bucket,
        file_role: insertedFile.file_role,
      },
    });

    return NextResponse.json({ ok: true, file: insertedFile });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}