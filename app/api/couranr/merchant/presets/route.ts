import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { settingsActorFrom } from "@/lib/couranr/settings/commands";
import { memberMay } from "@/lib/couranr/settings/permissions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  adoptRecommendation,
  createPreset,
  duplicatePreset,
  isPresetFailure,
  listPresets,
  setPresetArchived,
  updatePreset,
} from "@/lib/couranr/presets/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-010 / MER-011 — merchant delivery presets.
 *
 * `presets.read` is every active member, because a preset's whole purpose is
 * to prefill a delivery and a dispatcher creates those. `presets.write` is
 * owner and manager, matching `couranr_require_preset_manager` exactly.
 *
 * Every POST names an ACTION. Nothing here accepts a target state, and there
 * is no delete — archiving is the only removal, because deliveries cite
 * presets and a deleted one would leave those citations pointing at nothing.
 */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor || !memberMay(actor, "presets.read")) {
    return routeFailure("not_permitted", "You do not have access to this business.");
  }

  /*
   * The merchant's CATEGORIES drive which Couranr suggestions are offered, and
   * they are read SERVER-SIDE from the workspace rather than taken from the
   * query string. A caller-supplied category would let anyone enumerate the
   * global preset library for a category their business does not have — minor,
   * but it is also simply not the caller's fact to state.
   */
  const ws = await supabaseAdmin
    .from("couranr_merchant_workspaces")
    .select("business_category,secondary_categories")
    .eq("business_account_id", businessAccountId)
    .maybeSingle();

  if (ws.error) {
    return routeFailure("internal", "We could not load your business profile.");
  }

  const categories = [
    ws.data?.business_category,
    ...(Array.isArray(ws.data?.secondary_categories) ? ws.data.secondary_categories : []),
  ].filter((c: unknown): c is string => typeof c === "string" && c.length > 0);

  const result = await listPresets({
    businessAccountId,
    categories,
    includeArchived: req.nextUrl.searchParams.get("archived") === "1",
  });
  if (isPresetFailure(result)) return failureResponse(result);
  return NextResponse.json({ presets: result.value });
}

export async function POST(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor || !memberMay(actor, "presets.write")) {
    return routeFailure(
      "not_permitted",
      "Only an owner or a manager can change your business's presets."
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a JSON body.");
  }

  const action = String(body?.action ?? "");
  const presetId = String(body?.presetId ?? "");
  const needsPreset = ["update", "adopt", "duplicate", "archive", "restore"].includes(action);
  if (needsPreset && !UUID_RE.test(presetId)) {
    return routeFailure("invalid_input", "A preset is required.");
  }

  // The version the editor LOADED, never the current one. A missing version is
  // refused rather than defaulted, because a default would mean "overwrite
  // whatever is there" — which is exactly what the conflict check exists to
  // stop.
  const expectedVersion = Number(body?.expectedVersion);
  const needsVersion = ["update", "adopt"].includes(action);
  if (needsVersion && !Number.isInteger(expectedVersion)) {
    return routeFailure("invalid_input", "Reload the preset before saving it.");
  }

  if (action === "create") {
    const r = await createPreset({
      actor,
      businessAccountId,
      name: String(body?.name ?? ""),
      body: body?.body,
      sourcePresetId:
        typeof body?.sourcePresetId === "string" && UUID_RE.test(body.sourcePresetId)
          ? body.sourcePresetId
          : null,
    });
    if (isPresetFailure(r)) return failureResponse(r);
    return NextResponse.json({ result: r.value });
  }

  if (action === "update") {
    const r = await updatePreset({
      actor,
      businessAccountId,
      presetId,
      name: String(body?.name ?? ""),
      body: body?.body,
      expectedVersion,
    });
    if (isPresetFailure(r)) return failureResponse(r);
    return NextResponse.json({ result: r.value });
  }

  if (action === "adopt") {
    const r = await adoptRecommendation({
      actor,
      businessAccountId,
      presetId,
      expectedVersion,
    });
    if (isPresetFailure(r)) return failureResponse(r);
    return NextResponse.json({ result: r.value });
  }

  if (action === "duplicate") {
    const r = await duplicatePreset({
      actor,
      businessAccountId,
      presetId,
      newName: String(body?.name ?? ""),
    });
    if (isPresetFailure(r)) return failureResponse(r);
    return NextResponse.json({ result: r.value });
  }

  if (action === "archive" || action === "restore") {
    const r = await setPresetArchived({
      actor,
      businessAccountId,
      presetId,
      archived: action === "archive",
    });
    if (isPresetFailure(r)) return failureResponse(r);
    return NextResponse.json({ result: r.value });
  }

  return routeFailure("invalid_input", "That is not an action Couranr recognises.");
}
