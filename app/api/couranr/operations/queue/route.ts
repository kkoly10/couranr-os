import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isFulfillmentFailure, listOperationsLifecycle } from "@/lib/couranr/fulfillment/commands";
import {
  lifecycleStage,
  QUEUE_STAGES,
  type LifecycleStage,
} from "@/lib/couranr/fulfillment/lifecycle";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

/**
 * GET — OPS-002 Couranr Operations Queue.
 *
 * Returns every request Operations still has work on, each with the stage it
 * is at. The stage is derived HERE from the request, obligation, plan and
 * delivery rows rather than sent as a raw column, so the queue and the request
 * detail screen cannot disagree about what a row is waiting on.
 *
 * Operations only — a merchant is refused before any query runs, because this
 * read deliberately crosses business accounts.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await listOperationsLifecycle({ actor: actor.actor });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  const mappedEntries = result.value.entries.map((row) => {
    const stage = lifecycleStage({
      requestState: row.request.request_state,
      readinessState: row.request.readiness_state,
      paymentState: row.payment?.payment_state ?? null,
      promotionalCreditApplied: Boolean(row.promotionalCredit),
      servicePlanConfirmed: row.servicePlan !== null,
      servicePlanSource: row.servicePlan?.plan_source ?? null,
      automationExceptionOpen: Boolean(row.automationException),
      automationExceptionStage: row.automationException?.exception_stage ?? null,
      canonicalDeliveryExists: row.delivery !== null,
      assignmentActive: Boolean(row.assignment),
    });

    return {
      stage,
      // The queue's request rows are a SUBSET of the columns the detail view
      // selects, so the allow-list view model fills the absent ones with null
      // rather than leaking anything the projection did not ask for.
      request: toDeliveryRequestView(row.request),
      payment: row.payment
        ? {
            paymentState: row.payment.payment_state,
            payerType: row.payment.payer_type,
            amountCents: row.payment.amount_cents,
            currency: row.payment.currency,
          }
        : null,
      promotionalCredit: row.promotionalCredit
        ? {
            standardQuoteCents: row.promotionalCredit.standard_quote_cents,
            amountPaidCents: row.promotionalCredit.amount_paid_cents,
            promotionalCreditCents: row.promotionalCredit.promotional_credit_cents,
            currency: row.promotionalCredit.currency,
          }
        : null,
      servicePlan: row.servicePlan
        ? {
            scheduledPickupStart: row.servicePlan.scheduled_pickup_start,
            scheduledPickupEnd: row.servicePlan.scheduled_pickup_end,
            timezone: row.servicePlan.timezone,
            planSource: row.servicePlan.plan_source,
            plannerVersion: row.servicePlan.planner_version ?? null,
            dispatchNotBefore: row.servicePlan.dispatch_not_before ?? null,
            dispatchDeadline: row.servicePlan.dispatch_deadline ?? null,
            expectedServiceEnd: row.servicePlan.expected_service_end ?? null,
          }
        : null,
      automationException: row.automationException
        ? {
            stage: row.automationException.exception_stage,
            reason: row.automationException.reason,
            attempts: row.automationException.attempts,
            lastSeenAt: row.automationException.last_seen_at,
          }
        : null,
      delivery: row.delivery
        ? {
            id: row.delivery.id,
            fulfillmentState: row.delivery.fulfillment_state,
            capturedAmountCents: row.delivery.captured_amount_cents,
            scheduledPickupStart: row.delivery.scheduled_pickup_start,
            scheduledPickupEnd: row.delivery.scheduled_pickup_end,
            timezone: row.delivery.timezone,
            planSource: row.delivery.plan_source,
            plannerVersion: row.delivery.planner_version ?? null,
            dispatchNotBefore: row.delivery.dispatch_not_before ?? null,
            dispatchDeadline: row.delivery.dispatch_deadline ?? null,
            expectedServiceEnd: row.delivery.expected_service_end ?? null,
            // Read from the live assignment row, never assumed. This used to
            // be a hard-coded `false` with a comment saying dispatch did not
            // exist yet; it does now, and a stale constant here would tell an
            // operator a dispatched delivery still needs a driver.
            driverAssigned: Boolean(row.assignment),
            assignment: row.assignment
              ? {
                  id: row.assignment.id,
                  driverId: row.assignment.driver_id,
                  vehicleId: row.assignment.vehicle_id,
                  assignedAt: row.assignment.assigned_at,
                  version: row.assignment.version,
                }
              : null,
          }
        : null,
    };
  });

  const entries = mappedEntries.filter((entry) =>
    (QUEUE_STAGES as readonly LifecycleStage[]).includes(entry.stage as LifecycleStage)
  );

  return NextResponse.json({
    entries,
    /*
     * How many rows are in the queue's states versus how many were returned.
     * Reported rather than dropped: a queue that silently truncates reads as
     * "that is everything", and the row an operator never sees is the one that
     * is oldest and most overdue.
     */
    total: Math.min(result.value.total, entries.length),
    /*
     * Compares against the WORK entries only. Recently-scheduled rows are
     * folded in on top of the window and are not part of what was truncated.
     */
    truncated: result.value.total > result.value.entries.length,
  });
}
