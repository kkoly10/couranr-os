// app/api/auto/upload-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);

const MAX_FILE_MB = 10;
const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

type Kind = "license_front" | "license_back" | "selfie";

function safeExtFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function bucketForKind(kind: Kind) {
  return kind === "selfie" ? "renter-verifications" : "renter-licenses";
}

function columnForKind(kind: Kind) {
  if (kind === "license_front") return "license_front_url";
  if (kind === "license_back") return "license_back_url";
  return "selfie_url";
}

async function uploadPrivateImage(opts: {
  bucket: "renter-licenses" | "renter-verifications";
  rentalId: string;
  userId: string;
  kind: Kind;
  file: File;
}) {
  const { bucket, rentalId, userId, kind, file } = opts;

  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(`Invalid file type: ${file.type}`);
  }

  const bytes = await file.arrayBuffer();
  const sizeMb = bytes.byteLength / (1024 * 1024);
  if (sizeMb > MAX_FILE_MB) {
    throw new Error(`File too large. Max ${MAX_FILE_MB}MB`);
  }

  const ext = safeExtFromMime(file.type);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${userId}/${rentalId}/${kind}-${ts}.${ext}`;

  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, Buffer.from(bytes), {
    contentType: file.type,
    upsert: true,
  });

  if (error) throw new Error(error.message);

  // private bucket reference (we sign later)
  return `supabase://${bucket}/${path}`;
}

async function ensureRentalBelongsToUser(rentalId: string, userId: string) {
  const { data: rental, error } = await supabaseAdmin
    .from("rentals")
    .select("id,user_id,status,docs_complete,verification_status")
    .eq("id", rentalId)
    .eq("user_id", userId)
    .single();

  if (error || !rental) throw new Error("Rental not found");
  return rental;
}

async function recomputeDocsComplete(rentalId: string) {
  const { data: rv } = await supabaseAdmin
    .from("renter_verifications")
    .select("license_front_url,license_back_url,selfie_url")
    .eq("rental_id", rentalId)
    .maybeSingle();

  const complete = !!(rv?.license_front_url && rv?.license_back_url && rv?.selfie_url);

  // Always keep verification_status in pending once any file is submitted;
  // Only mark docs_complete true when all 3 exist.
  await supabaseAdmin
    .from("rentals")
    .update({
      docs_complete: complete,
      verification_status: "pending",
    })
    .eq("id", rentalId);

  return { complete, rv };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const fd = await req.formData();
    const rentalId = String(fd.get("rentalId") || "").trim();
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    // Ensure ownership
    await ensureRentalBelongsToUser(rentalId, user.id);

    // ----- MODE A (your current UI): rentalId + kind + file -----
    const kindRaw = String(fd.get("kind") || "").trim();
    const fileSingle = fd.get("file");

    if (kindRaw && fileSingle instanceof File) {
      if (!["license_front", "license_back", "selfie"].includes(kindRaw)) {
        return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
      }

      const kind = kindRaw as Kind;
      const bucket = bucketForKind(kind);

      const ref = await uploadPrivateImage({
        bucket,
        rentalId,
        userId: user.id,
        kind,
        file: fileSingle,
      });

      // upsert + set the specific column
      const col = columnForKind(kind);

      const { error: upErr } = await supabaseAdmin
        .from("renter_verifications")
        .upsert(
          {
            rental_id: rentalId,
            user_id: user.id,
            [col]: ref,
            captured_at: new Date().toISOString(),
          } as any,
          { onConflict: "rental_id" }
        );

      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

      // Audit event
      await supabaseAdmin.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: user.id,
        actor_role: "renter",
        event_type: "verification_file_uploaded",
        event_payload: { kind },
      });

      const { complete } = await recomputeDocsComplete(rentalId);

      return NextResponse.json(
        {
          ok: true,
          uploaded: { kind, ref },
          docs_complete: complete,
        },
        { status: 200 }
      );
    }

    // ----- MODE B (optional): rentalId + licenseFront + licenseBack + selfie -----
    const licenseFront = fd.get("licenseFront");
    const licenseBack = fd.get("licenseBack");
    const selfie = fd.get("selfie");

    if (
      licenseFront instanceof File &&
      licenseBack instanceof File &&
      selfie instanceof File
    ) {
      const frontRef = await uploadPrivateImage({
        bucket: "renter-licenses",
        rentalId,
        userId: user.id,
        kind: "license_front",
        file: licenseFront,
      });

      const backRef = await uploadPrivateImage({
        bucket: "renter-licenses",
        rentalId,
        userId: user.id,
        kind: "license_back",
        file: licenseBack,
      });

      const selfieRef = await uploadPrivateImage({
        bucket: "renter-verifications",
        rentalId,
        userId: user.id,
        kind: "selfie",
        file: selfie,
      });

      const { error: upErr } = await supabaseAdmin
        .from("renter_verifications")
        .upsert(
          {
            rental_id: rentalId,
            user_id: user.id,
            license_front_url: frontRef,
            license_back_url: backRef,
            selfie_url: selfieRef,
            captured_at: new Date().toISOString(),
          },
          { onConflict: "rental_id" }
        );

      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

      await supabaseAdmin.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: user.id,
        actor_role: "renter",
        event_type: "verification_submitted",
        event_payload: {},
      });

      const { complete } = await recomputeDocsComplete(rentalId);

      return NextResponse.json(
        {
          ok: true,
          uploaded: { frontRef, backRef, selfieRef },
          docs_complete: complete,
        },
        { status: 200 }
      );
    }

    // neither mode matched
    return NextResponse.json(
      { error: "Missing required upload fields. Expected (kind + file) or (licenseFront + licenseBack + selfie)." },
      { status: 400 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}