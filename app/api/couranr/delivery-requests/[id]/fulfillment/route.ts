import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  getActiveAssignmentForDelivery,
  getCanonicalDelivery,
  getOpenAutomationException,
  getPromotionalCredit,
  getServicePlan,
  isFulfillmentFailure,
} from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import {
  getNewestRefundAttemptForObligation,
  getObligationForRequest,
  isPaymentFailure,
} from "@/lib/couranr/payments/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — the lifecycle view of one request: payment, plan and delivery.
 *
 * Serves MER-007 and OPS-003 from one place so the merchant and Operations
 * cannot be looking at different answers. The scope is the caller's: a
 * merchant passes their business account and sees only their own; Operations
 * passes none and reads across businesses, which only they may do.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId");
  if (businessAccountId !== null && !UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  // Authorizes the read; also the only place the business scope is resolved.
  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const ob = await getObligationForRequest({ requestId: params.id, businessAccountId });
  if (isPaymentFailure(ob)) return failureResponse(ob);

  // Review item 6: the screen's refund controls are decided by the newest
  // attempt's state, not guessed from the obligation alone.
  let refundAttempt: {
    state: string;
    amountCents: number;
    retainedCents: number;
    reason: string;
  } | null = null;
  if (ob.value.obligation) {
    const att = await getNewestRefundAttemptForObligation({
      obligationId: String(ob.value.obligation.id),
    });
    if (isPaymentFailure(att)) return failureResponse(att);
    refundAttempt = att.value.attempt
      ? {
          state: att.value.attempt.attempt_state,
          amountCents: att.value.attempt.amount_cents,
          retainedCents: att.value.attempt.retained_cents,
          reason: att.value.attempt.reason,
        }
      : null;
  }

  const credit = await getPromotionalCredit({ requestId: params.id });
  if (isFulfillmentFailure(credit)) return failureResponse(credit);

  const plan = await getServicePlan({ requestId: params.id });
  if (isFulfillmentFailure(plan)) return failureResponse(plan);

  const delivery = await getCanonicalDelivery({ requestId: params.id, businessAccountId });
  if (isFulfillmentFailure(delivery)) return failureResponse(delivery);

  const assignment = delivery.value.delivery
    ? await getActiveAssignmentForDelivery({ deliveryId: String(delivery.value.delivery.id) })
    : { ok: true as const, value: { assignment: null } };
  if (isFulfillmentFailure(assignment)) return failureResponse(assignment);

  const automationException = await getOpenAutomationException({ requestId: params.id });
  if (isFulfillmentFailure(automationException)) return failureResponse(automationException);

  return NextResponse.json({
    readinessState: loaded.value.request.readiness_state,
    requestState: loaded.value.request.request_state,
    payment: ob.value.obligation
      ? {
          id: ob.value.obligation.id,
          amountCents: ob.value.obligation.amount_cents,
          currency: ob.value.obligation.currency,
          paymentState: ob.value.obligation.payment_state,
          payerType: ob.value.obligation.payer_type,
          // Batch 3 §A: the commercial approval instant and what it is.
          // provider_event = the signature-verified provider instant;
          // processing_fallback = provider instant unknown, stamp is Couranr
          // processing time. Never invented either way.
          authorizedAt: ob.value.obligation.authorized_at ?? null,
          authorizedAtSource: ob.value.obligation.authorized_at_source ?? null,
          authorizationProcessedAt: ob.value.obligation.authorization_processed_at ?? null,
          capturedAmountCents: ob.value.obligation.captured_amount_cents ?? null,
          refundedAmountCents: ob.value.obligation.refunded_amount_cents ?? null,
          refundedAt: ob.value.obligation.refunded_at ?? null,
          // Batch 3 §B: a provider hold with no local authorization — the
          // stale-quote case Operations must be able to release.
          staleProviderHold:
            Boolean(ob.value.obligation.provider_payment_intent_id) &&
            ["not_started", "requires_action"].includes(String(ob.value.obligation.payment_state)),
          refundAttempt,
        }
      : null,
    promotionalCredit: credit.value.credit
      ? {
          id: credit.value.credit.id,
          quoteVersionId: credit.value.credit.quote_version_id,
          standardQuoteCents: credit.value.credit.standard_quote_cents,
          amountPaidCents: credit.value.credit.amount_paid_cents,
          promotionalCreditCents: credit.value.credit.promotional_credit_cents,
          currency: credit.value.credit.currency,
          reason: credit.value.credit.reason,
          campaign: credit.value.credit.campaign,
          market: credit.value.credit.market,
          category: credit.value.credit.category,
          approvedAt: credit.value.credit.approved_at,
          status: credit.value.credit.status,
        }
      : null,
    servicePlan: plan.value.plan
      ? {
          id: plan.value.plan.id,
          planState: plan.value.plan.plan_state,
          scheduledPickupStart: plan.value.plan.scheduled_pickup_start,
          scheduledPickupEnd: plan.value.plan.scheduled_pickup_end,
          timezone: plan.value.plan.timezone,
          vehicleRequirement: plan.value.plan.vehicle_requirement,
          planSource: plan.value.plan.plan_source,
          plannerVersion: plan.value.plan.planner_version ?? null,
          marketKey: plan.value.plan.market_key ?? null,
          dispatchNotBefore: plan.value.plan.dispatch_not_before ?? null,
          dispatchDeadline: plan.value.plan.dispatch_deadline ?? null,
          expectedServiceEnd: plan.value.plan.expected_service_end ?? null,
          lastRevalidatedAt: plan.value.plan.last_revalidated_at ?? null,
          revalidatedLoadedMiles: plan.value.plan.revalidated_loaded_miles ?? null,
          revalidatedRouteDurationSeconds:
            plan.value.plan.revalidated_route_duration_seconds ?? null,
          revalidatedTrafficDelaySeconds:
            plan.value.plan.revalidated_traffic_delay_seconds ?? null,
        }
      : null,
    delivery: delivery.value.delivery
      ? {
          id: delivery.value.delivery.id,
          fulfillmentState: delivery.value.delivery.fulfillment_state,
          capturedAmountCents: delivery.value.delivery.captured_amount_cents,
          standardQuoteCents: delivery.value.delivery.standard_quote_cents ?? null,
          amountPaidCents: delivery.value.delivery.amount_paid_cents ?? null,
          promotionalCreditCents: delivery.value.delivery.promotional_credit_cents ?? null,
          promotionalCreditId: delivery.value.delivery.promotional_credit_id ?? null,
          scheduledPickupStart: delivery.value.delivery.scheduled_pickup_start,
          scheduledPickupEnd: delivery.value.delivery.scheduled_pickup_end,
          timezone: delivery.value.delivery.timezone,
          planSource: delivery.value.delivery.plan_source,
          plannerVersion: delivery.value.delivery.planner_version ?? null,
          marketKey: delivery.value.delivery.market_key ?? null,
          dispatchNotBefore: delivery.value.delivery.dispatch_not_before ?? null,
          dispatchDeadline: delivery.value.delivery.dispatch_deadline ?? null,
          expectedServiceEnd: delivery.value.delivery.expected_service_end ?? null,
          lastRevalidatedAt: delivery.value.delivery.last_revalidated_at ?? null,
          revalidatedLoadedMiles: delivery.value.delivery.revalidated_loaded_miles ?? null,
          revalidatedRouteDurationSeconds:
            delivery.value.delivery.revalidated_route_duration_seconds ?? null,
          revalidatedTrafficDelaySeconds:
            delivery.value.delivery.revalidated_traffic_delay_seconds ?? null,
          driverAssigned: Boolean(assignment.value.assignment),
          assignment: assignment.value.assignment
            ? {
                id: assignment.value.assignment.id,
                driverId: assignment.value.assignment.driver_id,
                vehicleId: assignment.value.assignment.vehicle_id,
                assignmentSource: assignment.value.assignment.assignment_source,
                assignedAt: assignment.value.assignment.assigned_at,
                version: assignment.value.assignment.version,
              }
            : null,
        }
      : null,
    automationException: automationException.value.exception
      ? {
          id: automationException.value.exception.id,
          stage: automationException.value.exception.exception_stage,
          reason: automationException.value.exception.reason,
          detail: automationException.value.exception.detail,
          attempts: automationException.value.exception.attempts,
          firstSeenAt: automationException.value.exception.first_seen_at,
          lastSeenAt: automationException.value.exception.last_seen_at,
        }
      : null,
  });
}
