// app/api/docs/upload-file/route.ts
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

function cleanName(name: string) {
  return (name || "file")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const supabase = svc();

    const fd = await req.formData();
    const requestId = String(fd.get("requestId") || "");
    const file = fd.get("file") as File | null;

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    // Verify ownership
    const { data: requestRow, error: reqErr } = await supabase
      .from("doc_requests")
      .select("id,user_id,status")
      .eq("id", requestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reqErr || !requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const bytes = await file.arrayBuffer();
    const safeName = cleanName(file.name || "file");
    const objectPath = `${user.id}/${requestId}/${Date.now()}-${Math.floor(
      1000 + Math.random() * 9000
    )}-${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from("docs-files")
      .upload(objectPath, new Uint8Array(bytes), {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message || "Upload failed" }, { status: 500 });
    }

    const { data: insertedFile, error: fileErr } = await supabase
      .from("doc_request_files")
      .insert({
        request_id: requestId,
        user_id: user.id,
        file_name: file.name || safeName,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size ?? null,
        storage_bucket: "docs-files",
        storage_path: objectPath,
      })
      .select("*")
      .single();

    if (fileErr || !insertedFile) {
      return NextResponse.json({ error: fileErr?.message || "Failed to record file" }, { status: 500 });
    }

    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      actor_role: "customer",
      event_type: "file_uploaded",
      event_payload: {
        file_name: insertedFile.file_name,
        size_bytes: insertedFile.size_bytes,
      },
    });

    return NextResponse.json({ ok: true, file: insertedFile });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
