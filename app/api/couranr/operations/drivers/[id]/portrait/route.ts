import { NextRequest, NextResponse } from "next/server";
import { resolveRequestActor, isActorDenied } from "@/lib/couranr/requests/actor";
import { routeFailure } from "@/lib/couranr/requests/respond";
import {
  MAX_DRIVER_PORTRAIT_UPLOAD_BYTES,
  classifyDriverPortraitFailure,
  publishDriverPortrait,
} from "@/lib/couranr/driver/publicProfile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_DRIVER_PORTRAIT_UPLOAD_BYTES + 100_000) {
    return routeFailure("invalid_input", "Portrait upload is too large.");
  }
  let form: FormData;
  try { form = await req.formData(); }
  catch { return routeFailure("invalid_input", "A portrait file is required."); }
  const file = form.get("portrait");
  const version = Number(form.get("expectedVersion"));
  if (!(file instanceof File) || file.size > MAX_DRIVER_PORTRAIT_UPLOAD_BYTES || file.size === 0 ||
      !Number.isInteger(version) || version < 1 || form.get("consentConfirmed") !== "true") {
    return routeFailure("invalid_input", "Choose a portrait and confirm the driver consent record.");
  }
  try {
    const { id } = await props.params;
    const result = await publishDriverPortrait({
      driverId: id, expectedVersion: version, actorUserId: actor.userId,
      consentConfirmed: true, bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ portraitUrl: `/api/couranr/driver-portrait/${result.publicId}` });
  } catch (cause) {
    const failure = classifyDriverPortraitFailure(cause);
    return routeFailure(failure.code, failure.message);
  }
}
