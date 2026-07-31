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
import { ReviewOutcomeActions } from "./ReviewOutcomeActions";
import {
  fetchDeliveryRequest,
  fetchMyBusinessAccounts,
  isApiFailure,
  type ApiFailure,
} from "./client";
import { REQUEST_STATE_LABELS, type DeliveryRequestView } from "@/lib/couranr/requests/view";
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

function addressLines(a: any): string[] {
  if (!a || typeof a !== "object") return [];
  return [
    [a.line1, a.line2].filter(Boolean).join(", "),
    [a.city, a.region, a.postalCode].filter(Boolean).join(" "),
    a.instructions ? `Notes: ${a.instructions}` : "",
  ].filter(Boolean);
}

export function DeliveryRequestDetail({ id }: { id: string }) {
  const [request, setRequest] = React.useState<DeliveryRequestView | null>(null);
  const [events, setEvents] = React.useState<any[]>([]);
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

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      // The route re-scopes by business account, so the client has to say which
      // one it is acting as. The server still verifies membership.
      const accounts = await fetchMyBusinessAccounts();
      const ids = isApiFailure(accounts)
        ? []
        : accounts.value.businessAccounts.map((a) => a.businessAccountId);

      // An Operations user has no membership rows; it reads with no scope.
      const attempts: Array<string | undefined> = ids.length > 0 ? ids : [undefined];

      for (const businessAccountId of attempts) {
        const r = await fetchDeliveryRequest({ id, businessAccountId });
        if (cancelled) return;
        if (!isApiFailure(r)) {
          setRequest(r.value.request);
          setEvents(r.value.events ?? []);
          setIsOperations(businessAccountId === undefined);
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
  }, [id]);

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

  return (
    <Stack gap={6}>
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

      {isOperations ? (
        <ReviewOutcomeActions
          request={request}
          onUpdated={(next) => {
            setRequest(next);
            // The decision appended an event. Re-read so the history below
            // shows it instead of going stale until the next full load.
            fetchDeliveryRequest({ id }).then((r) => {
              if (!isApiFailure(r)) setEvents(r.value.events ?? []);
            });
          }}
        />
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
