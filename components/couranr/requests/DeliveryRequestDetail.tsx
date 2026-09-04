"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Grid,
  Stack,
  Table,
  TableScroll,
  Text,
} from "@/components/couranr/primitives";
import {
  CardSkeleton,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@/components/couranr/states";
import { QuoteSummary } from "./QuoteSummary";
import { MerchantPaymentPanel } from "@/components/couranr/payments/MerchantPaymentPanel";
import { MerchantReadinessPanel } from "@/components/couranr/fulfillment/MerchantReadinessPanel";
import { MerchantProofPanel } from "@/components/couranr/dispatch/MerchantProofPanel";
import { HandoffCodePanel } from "@/components/couranr/dispatch/HandoffCodePanel";
import { DeliveryExecutionTimeline } from "@/components/couranr/dispatch/DeliveryExecutionTimeline";
import { OperationsDeliveryWorkbench } from "@/components/couranr/operations/OperationsDeliveryWorkbench";
import { fetchFulfillment, type FulfillmentView } from "@/components/couranr/fulfillment/client";
import {
  fetchDeliveryRequest,
  fetchMyBusinessAccounts,
  type IntakeSessionView,
  isApiFailure,
  type ApiFailure,
} from "./client";
import { formatCents, REQUEST_STATE_LABELS, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import { declineMessageFor } from "@/lib/couranr/requests/states";

/**
 * MER-007 — delivery detail.
 *
 * Reads through the authenticated API. There is no direct Supabase query here:
 * the canonical tables grant nothing to `authenticated`, so a browser query
 * would return an empty set and quietly render "not found" for a record the
 * user is entitled to see.
 */

const STATE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  awaiting_merchant_confirmation: "warning",
  awaiting_quote_acceptance: "warning",
  pending_couranr_review: "info",
  quote_revision_required: "warning",
  confirmed: "success",
  declined: "danger",
  cancelled: "neutral",
  closed: "neutral",
};

/**
 * MER-007 outcome copy (REV-001).
 *
 * `confirmed` is the dangerous one: on its own it reads as "paid, scheduled
 * and on its way". It means none of those — payment, readiness and
 * fulfillment are separate state groups and this slice touches none of them.
 * So the outcome is always spelled out rather than left to a one-word badge.
 */
const OUTCOME_COPY: Record<string, { tone: "info" | "success" | "warning" | "danger"; title: string; body: string }> = {
  confirmed: {
    tone: "success",
    title: "Couranr confirmed this delivery at the quoted price",
    // Replaced by `confirmedBody` once payment exists — see below. This is the
    // no-payment-yet case.
    body: "Nothing has been charged yet, and no driver has been assigned. Couranr will contact you about scheduling.",
  },
  awaiting_quote_acceptance: {
    tone: "warning",
    title: "Couranr confirmed the quote — waiting for the recipient to approve it",
    body: "This delivery is paid by the recipient, so Couranr is waiting for them to approve the price before anything is scheduled.",
  },
  quote_revision_required: {
    tone: "warning",
    title: "Couranr sent a revised quote",
    body: "The price changed after review, so this delivery needs a fresh approval before it can go ahead.",
  },
  declined: {
    tone: "danger",
    title: "Couranr could not confirm this delivery",
    // Body is replaced by the reason-specific message below when the decline
    // event carries a code this build recognises.
    body: "Nothing was charged. Contact Couranr Support if you would like to discuss alternatives.",
  },
};

/**
 * What "confirmed" means RIGHT NOW, in money terms.
 *
 * `confirmed` used to be the end of the road, so the banner could safely say
 * "Nothing has been charged yet". It no longer is: the same request state now
 * spans an authorized hold, a capture in flight and a completed capture, and
 * on the last two that sentence is simply false. The one thing that stays
 * true at every stage is that no driver is assigned.
 */
function confirmedBody(
  fulfillment: FulfillmentView | null,
  unavailable: boolean
): string {
  // Could not read the payment. Say so — do not assert anything about money.
  if (unavailable) {
    return "Couranr could not load the payment status for this delivery just now. Refresh, or contact Couranr Support.";
  }
  const state = fulfillment?.payment?.paymentState ?? null;
  const credit = fulfillment?.promotionalCredit ?? null;
  if (fulfillment?.delivery?.promotionalCreditId) {
    return "Couranr's promotional credit covers this delivery and it is scheduled. No card payment was captured. No driver has been assigned yet.";
  }
  if (fulfillment?.delivery || state === "captured") {
    return "The payment has been captured and this delivery is scheduled. No driver has been assigned yet.";
  }
  if (credit) {
    return "Couranr's promotional credit covers the quoted delivery amount. No card payment was captured. The delivery can proceed to service planning.";
  }
  if (state === "capture_pending") {
    return "Couranr is completing the payment for this delivery. No driver has been assigned yet.";
  }
  /*
   * A SETTLED failure. Saying "nothing was charged" here is safe precisely
   * because `failed` is only reachable from a verified provider status —
   * requires_payment_method via the terminal-resolution command, or a
   * signature-verified payment_failed event. It is never assumed.
   */
  if (state === "failed") {
    return "The payment provider ended the authorization for this delivery. Nothing was charged, and nothing is scheduled — it needs to be authorized again.";
  }
  if (state === "authorized") {
    return "The payment is authorized — the amount is held, not taken. No driver has been assigned yet.";
  }
  return OUTCOME_COPY.confirmed.body;
}

function addressLines(a: any): string[] {
  if (!a || typeof a !== "object") return [];
  return [
    [a.line1, a.line2].filter(Boolean).join(", "),
    [a.city, a.region, a.postalCode].filter(Boolean).join(" "),
    a.instructions ? `Notes: ${a.instructions}` : "",
  ].filter(Boolean);
}

export function DeliveryRequestDetail({
  id,
  surface,
}: {
  id: string;
  surface: "operations" | "business";
}) {
  const [request, setRequest] = React.useState<DeliveryRequestView | null>(null);
  const [events, setEvents] = React.useState<any[]>([]);
  const [intake, setIntake] = React.useState<IntakeSessionView | null>(null);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [loading, setLoading] = React.useState(true);
  /**
   * Whether this viewer read the request WITHOUT a business scope. Only
   * Couranr Operations can: `canActOnDeliveryRequest` denies an unscoped read
   * to a merchant (`not_a_member`), so a successful unscoped read identifies
   * the viewer.
   *
   * This only decides whether the decision panel is drawn. It is not the
   * security boundary — every review command re-checks the actor server-side
   * and answers 403 to a merchant regardless of what the browser rendered.
   */
  const [isOperations, setIsOperations] = React.useState(false);
  /** Which business this viewer read the request as; null for Operations. */
  const [viewerBusinessAccountId, setViewerBusinessAccountId] = React.useState<string | null>(null);
  /**
   * Payment, plan and delivery for this request, from the one endpoint that
   * serves both surfaces — so the merchant and Operations cannot be shown
   * different answers about the same delivery.
   */
  const [fulfillment, setFulfillment] = React.useState<FulfillmentView | null>(null);
  /** The payment/plan/delivery read failed. Never rendered as "nothing yet". */
  const [fulfillmentUnavailable, setFulfillmentUnavailable] = React.useState(false);

  /**
   * Re-read after any lifecycle action, so every panel agrees.
   *
   * A `useCallback` keyed on the request id, not a plain function: the initial
   * load calls it too, and a fresh identity on every render would either make
   * the load effect re-run forever or force a lie in its dependency list.
   */
  const reloadFulfillment = React.useCallback(
    async (businessAccountId: string | null) => {
      const r = await fetchFulfillment({ id, businessAccountId });
      if (isApiFailure(r)) {
        /*
         * FAIL CLOSED. A swallowed failure left `fulfillment` null, and null
         * is indistinguishable from "no payment exists" — so a merchant whose
         * delivery had been captured and scheduled was shown "Nothing has been
         * charged yet." Not knowing must never render as a fact about money.
         */
        setFulfillmentUnavailable(true);
        return;
      }
      setFulfillmentUnavailable(false);
      setFulfillment(r.value);
    },
    [id]
  );

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      /*
       * The route already knows which authority surface invoked this component;
       * do not infer it from whether the signed-in person ALSO belongs to a
       * Business workspace. Pilot operators can legitimately be Business
       * owners, and that old heuristic hid every Operations decision control.
       */
      if (surface === "operations") {
        const r = await fetchDeliveryRequest({ id });
        if (cancelled) return;
        if (isApiFailure(r)) {
          setFailure(r);
          setLoading(false);
          return;
        }
        setFailure(null);
        setRequest(r.value.request);
        setEvents(r.value.events ?? []);
        setIntake(r.value.intake ?? null);
        setIsOperations(true);
        setViewerBusinessAccountId(null);
        void reloadFulfillment(null);
        setLoading(false);
        return;
      }

      // Business surface: resolve an explicit tenant membership and never fall
      // back to the unscoped Operations read just because this user is dual-role.
      const accounts = await fetchMyBusinessAccounts();
      if (cancelled) return;
      if (isApiFailure(accounts)) {
        setFailure(accounts);
        setLoading(false);
        return;
      }

      const ids = accounts.value.businessAccounts.map((a) => a.businessAccountId);
      if (ids.length === 0) {
        setLoading(false);
        return;
      }

      for (const businessAccountId of ids) {
        const r = await fetchDeliveryRequest({ id, businessAccountId });
        if (cancelled) return;
        if (!isApiFailure(r)) {
          setFailure(null);
          setRequest(r.value.request);
          setEvents(r.value.events ?? []);
          setIntake(r.value.intake ?? null);
          setIsOperations(false);
          setViewerBusinessAccountId(businessAccountId);
          void reloadFulfillment(businessAccountId);
          setLoading(false);
          return;
        }
        // A 404 under one account may still be visible under another.
        if (r.status !== 404) {
          setFailure(r);
          setLoading(false);
          return;
        }
        setFailure(r);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, reloadFulfillment, surface]);

  if (loading) {
    return (
      <LoadingState label="Loading this delivery">
        <Stack gap={4}>
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
        </Stack>
      </LoadingState>
    );
  }

  if (!request) {
    if (failure?.status === 403) return <PermissionDeniedState />;
    // A record that is not yours and a record that does not exist look the
    // same on purpose.
    return (
      <ErrorState
        title="Delivery not found"
        body="This delivery does not exist, or it belongs to a different Couranr account."
      />
    );
  }



  const refreshOperations = () => {
    void reloadFulfillment(null);
    void fetchDeliveryRequest({ id }).then((r) => {
      if (!isApiFailure(r)) {
        setRequest(r.value.request);
        setEvents(r.value.events ?? []);
        setIntake(r.value.intake ?? null);
      }
    });
  };

  return (
    <Stack gap={6}>
      {isOperations ? (
        <OperationsDeliveryWorkbench
          request={request}
          fulfillment={fulfillment}
          fulfillmentUnavailable={fulfillmentUnavailable}
          onRequestUpdated={(next) => {
            setRequest(next);
            refreshOperations();
          }}
          onLifecycleChanged={refreshOperations}
        />
      ) : null}

      {!isOperations ? (
      <Card>
        <CardHeader
          title="Status"
          actions={
            <Badge tone={STATE_TONE[request.requestState] ?? "neutral"}>
              {REQUEST_STATE_LABELS[request.requestState] ?? request.requestState}
            </Badge>
          }
        />
        {OUTCOME_COPY[request.requestState] ? (
          <Alert
            tone={OUTCOME_COPY[request.requestState].tone}
            title={OUTCOME_COPY[request.requestState].title}
          >
            {request.requestState === "declined"
              ? `${declineMessageFor(declineReasonCode(events))} Nothing was charged.`
              : request.requestState === "confirmed"
                ? confirmedBody(fulfillment, fulfillmentUnavailable)
                : OUTCOME_COPY[request.requestState].body}
          </Alert>
        ) : null}
        <Grid columns={3}>
          <Detail label="Created" value={new Date(request.createdAt).toLocaleString()} />
          <Detail
            label="Submitted"
            value={
              request.submittedAt ? new Date(request.submittedAt).toLocaleString() : "Not submitted"
            }
          />
          <Detail label="Service area" value={serviceAreaCopy(request.serviceAreaReviewState)} />
        </Grid>
      </Card>
      ) : null}

      <Grid columns={2}>
        <Card>
          <CardHeader title="Pickup" />
          <Stack gap={1}>
            {addressLines(request.pickupAddress).map((l, i) => (
              <Text key={i} size="sm">
                {l}
              </Text>
            ))}
          </Stack>
        </Card>
        <Card>
          <CardHeader title="Dropoff" />
          <Stack gap={1}>
            {addressLines(request.dropoffAddress).map((l, i) => (
              <Text key={i} size="sm">
                {l}
              </Text>
            ))}
            {request.recipientName ? (
              <Text size="sm" muted>
                Recipient: {request.recipientName}
              </Text>
            ) : null}
          </Stack>
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Shipment" />
        <Grid columns={4}>
          <Detail label="Loaded miles" value={request.loadedMiles ?? "—"} />
          <Detail label="Weight" value={request.weightLb === null ? "—" : `${request.weightLb} lb`} />
          <Detail label="Additional stops" value={request.additionalStops} />
          <Detail label="Service level" value={request.serviceLevel} />
        </Grid>
      </Card>

      <QuoteSummary request={request} />



      {fulfillment?.promotionalCredit ? (
        <Card>
          <CardHeader
            title="Couranr promotional credit"
            description="This pilot delivery is commercially covered without fabricating a Stripe authorization."
          />
          <Grid columns={3}>
            <Detail
              label="Standard quote"
              value={formatCents(fulfillment.promotionalCredit.standardQuoteCents)}
            />
            <Detail
              label="Amount paid"
              value={formatCents(fulfillment.promotionalCredit.amountPaidCents)}
            />
            <Detail
              label="Couranr credit"
              value={formatCents(fulfillment.promotionalCredit.promotionalCreditCents)}
            />
          </Grid>
          <Text size="xs" muted>
            {fulfillment.promotionalCredit.reason} · {fulfillment.promotionalCredit.campaign}
          </Text>
        </Card>
      ) : null}

      {/* MER-007 payment. Operations reviews; it does not pay. A fully credited
          pilot request deliberately suppresses card authorization. */}
      {!isOperations && !fulfillment?.promotionalCredit ? (
        <MerchantPaymentPanel
          request={request}
          businessAccountId={viewerBusinessAccountId}
        />
      ) : null}

      {/* MER-007 readiness, and the scheduled result once Couranr captures. */}
      {!isOperations ? (
        <MerchantReadinessPanel
          request={request}
          fulfillment={fulfillment}
          businessAccountId={viewerBusinessAccountId}
          onChanged={() => {
            void reloadFulfillment(viewerBusinessAccountId);
            void fetchDeliveryRequest({
              id,
              businessAccountId: viewerBusinessAccountId ?? undefined,
            }).then((r) => {
              if (!isApiFailure(r)) setRequest(r.value.request);
            });
          }}
        />
      ) : null}

      {!isOperations && fulfillment?.servicePlan ? (
        <Card>
          <CardHeader
            title="Pickup schedule"
            description={
              fulfillment.servicePlan.planSource === "automatic"
                ? "Couranr scheduled this delivery automatically from your request and current capacity."
                : "Couranr Operations confirmed this pickup window."
            }
          />
          <Grid columns={3}>
            <Detail
              label="Pickup start"
              value={new Date(fulfillment.servicePlan.scheduledPickupStart).toLocaleString()}
            />
            <Detail
              label="Pickup end"
              value={new Date(fulfillment.servicePlan.scheduledPickupEnd).toLocaleString()}
            />
            <Detail
              label="Status"
              value={
                fulfillment.delivery?.driverAssigned
                  ? "Driver assigned"
                  : fulfillment.servicePlan.planSource === "automatic"
                    ? "Scheduled — Couranr will dispatch automatically"
                    : "Scheduled"
              }
            />
          </Grid>
          {fulfillment.servicePlan.planSource === "automatic" &&
          fulfillment.servicePlan.expectedServiceEnd ? (
            <Text size="xs" muted>
              Expected service window ends around{" "}
              {new Date(fulfillment.servicePlan.expectedServiceEnd).toLocaleString()}.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* MER-007 execution. Only once a canonical delivery exists — before
          that there is no driver, no state to follow and no proof.

          The merchant sees WHAT HAPPENED and issues the two credentials. They
          do not see proof media: PHO-001's authorized viewers are Operations,
          the assigned driver and the owning customer, and the merchant is
          deliberately not among them. */}
      {!isOperations && fulfillment?.delivery ? (
        <>
          <DeliveryExecutionTimeline current={fulfillment.delivery.fulfillmentState} />
          <HandoffCodePanel
            deliveryId={fulfillment.delivery.id}
            kind="merchant_pickup"
            surface="merchant"
          />
          <HandoffCodePanel
            deliveryId={fulfillment.delivery.id}
            kind="recipient_dropoff"
            surface="merchant"
          />
          <MerchantProofPanel deliveryId={fulfillment.delivery.id} />
        </>
      ) : null}

      {/* P5-001 — what Couranr understood, for Operations. Deterministic
          policy reasons and MODEL worries are shown apart, because they are
          different things: one is Couranr's rules over confirmed facts, the
          other is an unconfirmed signal. */}
      {isOperations && intake ? (
        <Card>
          <CardHeader
            title="Shipment understanding"
            description={`Fact schema ${intake.session.fact_schema_version ?? ""} · policy ${intake.session.policy_version ?? "not evaluated"}`}
          />
          <Stack gap={3}>
            {intake.revisions.length > 0 ? (
              <div>
                <Text size="sm" muted>Merchant said (revision {intake.revisions[intake.revisions.length - 1].revision}):</Text>
                <Text>&ldquo;{intake.revisions[intake.revisions.length - 1].raw_description}&rdquo;</Text>
              </div>
            ) : null}
            {intake.facts.length > 0 ? (
              <TableScroll>
                <Table caption="Structured facts and provenance">
                  <thead>
                    <tr><th>Fact</th><th>Value</th><th>Source</th><th>Authority</th></tr>
                  </thead>
                  <tbody>
                    {intake.facts.map((f) => (
                      <tr key={f.fact_key}>
                        <td>{f.fact_key}</td>
                        <td>
                          {f.value === null
                            ? "withdrawn"
                            : typeof f.value === "boolean"
                              ? f.value
                                ? "yes"
                                : "no"
                              : String(f.value)}
                        </td>
                        <td>{f.source}</td>
                        <td>
                          <Badge tone={f.authority === "confirmed" || f.authority === "overridden" ? "success" : "neutral"}>
                            {f.authority}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            ) : null}
            {intake.session.policy_disposition ? (
              <div>
                <Text size="sm" muted>
                  Shipment policy: <strong>{intake.session.policy_disposition}</strong>
                  {" · capability: "}{intake.session.operational_capability ?? "—"}
                </Text>
                {(intake.session.policy_reasons ?? []).length > 0 ? (
                  <Text size="sm">Rules: {(intake.session.policy_reasons ?? []).join(", ")}</Text>
                ) : null}
                {(intake.session.policy_risk_signals ?? []).length > 0 ? (
                  <Text size="sm">Model signals (unconfirmed): {(intake.session.policy_risk_signals ?? []).join(", ")}</Text>
                ) : null}
              </div>
            ) : null}
            {intake.session.current_clarification ? (
              <Text size="sm" muted>
                Open question to merchant: {intake.session.current_clarification.question}
              </Text>
            ) : null}
          </Stack>
        </Card>
      ) : null}



      <Card>
        <CardHeader title="History" description="Every change Couranr recorded for this request." />
        {events.length === 0 ? (
          <Text size="sm" muted>
            No activity recorded yet.
          </Text>
        ) : (
          <TableScroll>
            <Table caption="Request history">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">By</th>
                  <th scope="col">To</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.created_at).toLocaleString()}</td>
                    <td>{e.command}</td>
                    <td>{e.actor_type}</td>
                    <td>{e.to_state ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>
    </Stack>
  );
}

function serviceAreaCopy(state: string) {
  switch (state) {
    case "in_area":
      return "In the Couranr service area";
    case "out_of_area_review":
      return "Couranr is reviewing coverage";
    case "declined":
      return "Outside the Couranr service area";
    default:
      return "Couranr will confirm coverage";
  }
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" muted>
        {label}
      </Text>
      <Text strong>{value}</Text>
    </div>
  );
}

/**
 * The reason code from the most recent decline event, if there is one.
 *
 * `reasonCode` is what `couranr-decline-v1` writes; `legacyReason` is the key
 * the placeholder taxonomy used. Both are read because append-only means old
 * events keep their original shape — and `declineMessageFor` maps any code it
 * does not recognise, including every retired one, onto the generic message.
 * So a merchant never sees a raw code, an empty string or "undefined".
 *
 * The internal note is not consulted, and cannot be: the read path that
 * produced `events` never selected it.
 */
function declineReasonCode(events: any[]): string | null {
  // `events` arrives newest first.
  const e = (events ?? []).find((x) => x?.command === "decline_delivery_request");
  if (!e) return null;
  return e.reasonCode ?? e.legacyReason ?? null;
}
