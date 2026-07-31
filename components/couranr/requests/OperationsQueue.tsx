"use client";

import * as React from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Stack,
  Table,
  TableScroll,
  Text,
} from "@/components/couranr/primitives";
import {
  ConflictState,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  TableSkeleton,
} from "@/components/couranr/states";
import {
  beginReview,
  fetchReviewQueue,
  isApiFailure,
  withReference,
  type ApiFailure,
} from "./client";
import { REVIEW_REASON_LABELS, formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";

/**
 * OPS-002 — the Couranr Operations Queue.
 *
 * Lists requests in `pending_couranr_review`, oldest submission first. Opening
 * a request records that Couranr began the review and links through to OPS-003,
 * where the outcome — confirm as quoted, revised quote, or could not confirm —
 * is decided.
 */
export function OperationsQueue() {
  const [requests, setRequests] = React.useState<DeliveryRequestView[] | null>(null);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await fetchReviewQueue();
    if (isApiFailure(r)) {
      setFailure(r);
      setRequests([]);
      return;
    }
    setFailure(null);
    setRequests(r.value.requests);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function onBeginReview(request: DeliveryRequestView) {
    setBusyId(request.id);
    const r = await beginReview({ id: request.id, expectedVersion: request.version });
    setBusyId(null);
    if (isApiFailure(r)) {
      setFailure(r);
      return;
    }
    setFailure(null);
    setRequests((prev) =>
      (prev ?? []).map((x) => (x.id === r.value.request.id ? r.value.request : x))
    );
  }

  if (requests === null) {
    return (
      <LoadingState label="Loading the Couranr Operations Queue">
        <TableSkeleton rows={5} columns={5} />
      </LoadingState>
    );
  }

  if (failure?.status === 401 || failure?.status === 403) {
    return <PermissionDeniedState />;
  }

  return (
    <Stack gap={4}>
      {failure?.code === "version_conflict" ? (
        <ConflictState action={{ label: "Reload the queue", onClick: load }} />
      ) : null}
      {failure && failure.code !== "version_conflict" ? (
        <ErrorState title="The queue could not be updated" body={withReference(failure)} />
      ) : null}

      {requests.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          body="Submitted delivery requests appear here, oldest first."
          action={{ label: "Refresh", onClick: load }}
        />
      ) : (
        <Card padding="flush">
          <CardHeader
            title="Pending Couranr review"
            description={`${requests.length} request${requests.length === 1 ? "" : "s"} waiting.`}
            actions={
              <Button size="sm" onClick={load}>
                Refresh
              </Button>
            }
          />
          <TableScroll>
            <Table caption="Requests pending Couranr review">
              <thead>
                <tr>
                  <th scope="col">Submitted</th>
                  <th scope="col">Route</th>
                  <th scope="col">Quote</th>
                  <th scope="col">Subtotal</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}</td>
                    <td>
                      {/*
                        OPS-003, not the merchant surface. Linking Operations
                        at /business/… sent them to a route the surface guard
                        redirects them off, which made the review workspace
                        unreachable from the queue.
                      */}
                      <Link href={`/operations/deliveries/${r.id}`}>
                        {r.loadedMiles === null ? "—" : `${r.loadedMiles} mi`}
                      </Link>
                      {r.quote.reviewReasons.length > 0 ? (
                        <Text size="xs" muted>
                          {r.quote.reviewReasons
                            .map((c) => REVIEW_REASON_LABELS[c] ?? c)
                            .join("; ")}
                        </Text>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={r.quote.status === "estimated" ? "success" : "warning"}>
                        {r.quote.status === "estimated" ? "Estimated" : "Manual review"}
                      </Badge>
                    </td>
                    <td>{formatCents(r.quote.deliverySubtotalCents)}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busyId === r.id}
                        onClick={() => onBeginReview(r)}
                      >
                        Open for review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
    </Stack>
  );
}
