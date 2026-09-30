import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { settingsActorFrom } from "@/lib/couranr/settings/commands";
import { memberMay } from "@/lib/couranr/settings/permissions";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import type { PublicErrorCode } from "@/lib/couranr/errors";
import {
  completeBusinessPaymentSetup,
  getBusinessPaymentMethod,
  isBusinessPaymentFailure,
  startBusinessPaymentSetup,
} from "@/lib/couranr/billing/paymentMethod";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ActorGate = { ok: true; userId: string } | { ok: false; code: PublicErrorCode; message: string };
async function actorFor(req: NextRequest, businessAccountId: string, write: boolean): Promise<ActorGate> {
  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return { ok: false, code: resolved.code, message: resolved.error };
  const member = settingsActorFrom(resolved);
  if (!member || !memberMay(member, write ? "billing.manage_payment_method" : "billing.read")) {
    return { ok: false, code: "not_permitted", message: write
      ? "Only a business owner or manager may save its card."
      : "You do not have access to this business's billing." };
  }
  return { ok: true, userId: resolved.userId };
}

/** Only brand and last four, never a PaymentMethod id or client secret. */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) return routeFailure("invalid_input", "A business is required.");
  const gate = await actorFor(req, businessAccountId, false);
  if (gate.ok === false) return routeFailure(gate.code, gate.message);
  const result = await getBusinessPaymentMethod(businessAccountId);
  if (isBusinessPaymentFailure(result)) return failureResponse(result);
  return NextResponse.json({ paymentMethod: result.value }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * start records explicit off-session consent and returns a SetupIntent secret;
 * complete ignores all browser payment claims and re-reads Stripe itself.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 512) return routeFailure("invalid_input", "Card setup details are too large.");
    body = JSON.parse(raw);
  } catch {
    return routeFailure("invalid_input", "Send card setup details as JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return routeFailure("invalid_input", "Card setup details are required.");
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["businessAccountId", "action", "consentAccepted", "attemptId"].includes(key)) ||
      !UUID_RE.test(String(input.businessAccountId ?? "")) ||
      (input.action !== "start" && input.action !== "complete") ||
      (input.action === "start" && (input.consentAccepted !== true || input.attemptId !== undefined)) ||
      (input.action === "complete" && (input.consentAccepted !== undefined ||
        !UUID_RE.test(String(input.attemptId ?? ""))))) {
    return routeFailure("invalid_input", "Choose a valid card setup action and confirm the saved-card terms.");
  }
  const businessAccountId = String(input.businessAccountId).toLowerCase();
  const gate = await actorFor(req, businessAccountId, true);
  if (gate.ok === false) return routeFailure(gate.code, gate.message);
  const actorUserId = gate.userId;
  if (input.action === "start") {
    const result = await startBusinessPaymentSetup({ businessAccountId, actorUserId });
    if (isBusinessPaymentFailure(result)) return failureResponse(result);
    return NextResponse.json(result.value,
      { headers: { "Cache-Control": "private, no-store" } });
  }
  const result = await completeBusinessPaymentSetup({
    businessAccountId, actorUserId, attemptId: String(input.attemptId).toLowerCase(),
  });
  if (isBusinessPaymentFailure(result)) return failureResponse(result);
  return NextResponse.json({ paymentMethod: result.value },
    { headers: { "Cache-Control": "private, no-store" } });
}
