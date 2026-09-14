import { NextRequest, NextResponse } from "next/server";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";
import {
  applyPromotionalCredit,
  isFulfillmentFailure,
} from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function textField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= max ? clean : null;
}

/**
 * POST — apply a full Couranr promotional credit to the exact current quote.
 *
 * Operations only. The browser carries NO amount, quote id, payer, source,
 * status or target state. The database re-checks every commercial invariant,
 * preserves the request's original source and writes the immutable event.
 * After settlement, normal automatic fulfillment is nudged; that path does not
 * call Stripe for credited deliveries.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const reason = textField(body?.reason, 160);
  const campaign = textField(body?.campaign, 120);
  const market = textField(body?.market, 120);
  const category = textField(body?.category, 120);
  if (!reason || !campaign || !market || !category) {
    return routeFailure("invalid_input", "Complete the promotional-credit audit fields.");
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId: null,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const result = await applyPromotionalCredit({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
    expectedVersion: Number(loaded.value.request.version),
    reason,
    campaign,
    market,
    category,
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  // Best-effort nudge. Settlement is already committed and idempotent; the
  // periodic worker is the recovery path if this immediate advance is lost.
  await advanceAutomaticFulfillment(params.id);

  return NextResponse.json({
    credit: {
      id: result.value.credit.id,
      standardQuoteCents: result.value.credit.standard_quote_cents,
      promotionalCreditCents: result.value.credit.promotional_credit_cents,
      reason: result.value.credit.reason,
      campaign: result.value.credit.campaign,
      market: result.value.credit.market,
      category: result.value.credit.category,
    },
  });
}
