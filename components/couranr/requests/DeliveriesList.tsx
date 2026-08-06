"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Table,
  TableScroll,
  Text,
  buttonClassName,
} from "@/components/couranr/primitives";
import { Button } from "@/components/couranr/primitives";
import { Field, Input, Select } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  fetchDeliveryRequests,
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "./client";
import { fetchFulfillment, setReadinessFromBrowser } from "@/components/couranr/fulfillment/client";
import {
  READINESS_LABEL,
  READINESS_TONE,
} from "@/components/couranr/fulfillment/MerchantReadinessPanel";
import {
  READINESS_STATES,
  REQUEST_STATES,
  REVIEW_STATES,
  canChangeReadiness,
  type ReadinessState,
} from "@/lib/couranr/requests/states";
import { DELIVERY_REQUEST_WRITE_ROLES } from "@/lib/couranr/requests/permissions";
import { REACHABLE_PAYMENT_STATES } from "@/lib/couranr/payments/states";
import {
  REQUEST_STATE_LABELS,
  formatCents,
  type DeliveryRequestView,
} from "@/lib/couranr/requests/view";
import { PAYABLE_REQUEST_STATES } from "@/lib/couranr/fulfillment/lifecycle";
import {
  DUPLICATE_STORAGE_KEY,
  EMPTY_FACETS,
  filterDeliveryRows,
  type DeliveriesFacets,
} from "@/lib/couranr/requests/listFilters";

/**
 * MER-004 — the deliveries list. Find and manage requests across the FOUR
 * INDEPENDENT state groups (STA-001): request, readiness, review, payment.
 *
 * Each group gets its own badge column and its own filter. The canonical mock
 * draws one merged "Status" column; the registry's constraint for this screen
 * — "Never collapse independent state groups into one misleading status" —
 * wins over the mock, so no merged status exists anywhere on this screen.
 *
 * What is NOT here, and why:
 *  - Cancel: no cancel command exists in this slice — `cancelled`/`closed`
 *    are deliberately unreachable until the cancellation slice lands
 *    (CAN-001 fees apply from confirmation). No affordance is rendered,
 *    because offering an action the server must refuse is a lie.
 *  - A "today/scheduled" column: the list endpoint carries no schedule; the
 *    per-row lifecycle view does, and the detail page renders it.
 */

/** Same bound as the dashboard, announced on the page when it bites. */
const PAYMENT_CHECK_LIMIT = 25;

const REVIEW_LABELS: Record<string, string> = {
  not_required: "Not required",
  pending: "Pending",
  accepted_as_quoted: "Accepted as quoted",
  requoted: "Requoted",
  declined: "Declined",
};

const paymentLabel = (p: string | null | undefined) =>
  p ? p.replace(/_/g, " ") : "No payment yet";

export function DeliveriesList() {
  const router = useRouter();

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [rows, setRows] = React.useState<DeliveryRequestView[] | null>(null);
  const [rowsError, setRowsError] = React.useState<ApiFailure | null>(null);
  const [payments, setPayments] = React.useState<Map<string, string | null>>(new Map());
  const [paymentsChecked, setPaymentsChecked] = React.useState(0);
  const [paymentsTruncated, setPaymentsTruncated] = React.useState(false);

  const [facets, setFacets] = React.useState<DeliveriesFacets>(EMPTY_FACETS);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busyRow, setBusyRow] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setAccountsError(r);
        if (r.status === 401) setAccounts([]);
        return;
      }
      setAccounts(r.value.businessAccounts);
      if (r.value.businessAccounts.length >= 1) {
        setBusinessAccountId(r.value.businessAccounts[0].businessAccountId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    setRows(null);
    setRowsError(null);
    setPayments(new Map());
    setPaymentsChecked(0);
    setPaymentsTruncated(false);

    fetchDeliveryRequests({ businessAccountId }).then(async (r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setRowsError(r);
        return;
      }
      setRows(r.value.requests);

      // Payment facts are per-request lifecycle reads; only a request Couranr
      // has priced can carry an obligation, so the fan-out covers the payable
      // states, newest first, and the page says how far it reached.
      const payable = r.value.requests
        .filter((q) => (PAYABLE_REQUEST_STATES as readonly string[]).includes(q.requestState))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      const checked = payable.slice(0, PAYMENT_CHECK_LIMIT);
      setPaymentsTruncated(payable.length > checked.length);
      setPaymentsChecked(checked.length);

      const views = await Promise.all(
        checked.map((q) => fetchFulfillment({ id: q.id, businessAccountId }))
      );
      if (cancelled) return;
      const map = new Map<string, string | null>();
      for (let i = 0; i < checked.length; i++) {
        const v = views[i];
        if (isApiFailure(v)) continue; // unreadable = unchecked, never guessed
        map.set(checked[i].id, v.value.payment ? v.value.payment.paymentState : null);
      }
      setPayments(map);
    });

    return () => {
      cancelled = true;
    };
  }, [businessAccountId, reloadKey]);

  /* ---------------------------------------------------- account resolution */

  if (accounts === null && accountsError) {
    return (
      <ErrorState
        title="We could not check your account"
        body={withReference(accountsError)}
        action={{ label: "Reload", onClick: () => router.refresh() }}
      />
    );
  }
  if (accounts === null) {
    return (
      <LoadingState label="Loading your deliveries">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }
  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to see your deliveries"
        body="You need to be signed in to a Couranr business account."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No business account yet"
        body="Set up your business workspace to start creating deliveries."
        action={{ label: "Set up your workspace", href: "/business/onboarding" }}
      />
    );
  }

  const activeAccount =
    accounts.find((a) => a.businessAccountId === businessAccountId) ?? accounts[0];
  // UX mirror of DRP-001 only; the server re-checks every write.
  const mayWrite = (DELIVERY_REQUEST_WRITE_ROLES as readonly string[]).includes(
    activeAccount.role
  );

  const filtered =
    rows === null ? [] : filterDeliveryRows(rows, facets, payments);
  const anyFacet =
    facets.requestState !== "" ||
    facets.readinessState !== "" ||
    facets.reviewState !== "" ||
    facets.paymentState !== "" ||
    facets.search.trim() !== "";

  async function markReady(row: DeliveryRequestView) {
    setActionError(null);
    setBusyRow(row.id);
    const r = await setReadinessFromBrowser({
      id: row.id,
      businessAccountId,
      expectedVersion: row.version,
      readiness: "ready",
    });
    setBusyRow(null);
    if (isApiFailure(r)) {
      setActionError(
        r.status === 409
          ? "That delivery changed since this list loaded. It has been refreshed — check its current state."
          : withReference(r)
      );
      if (r.status === 409) setReloadKey((k) => k + 1);
      return;
    }
    setReloadKey((k) => k + 1);
  }

  /**
   * Duplicate = client-side prefill of the create flow from this row. The new
   * draft re-prices SERVER-side on calculate, so nothing about the old quote
   * carries over — which is why no new backend is needed or wanted.
   */
  function duplicate(row: DeliveryRequestView) {
    try {
      sessionStorage.setItem(
        DUPLICATE_STORAGE_KEY,
        JSON.stringify({
          pickupAddress: row.pickupAddress,
          dropoffAddress: row.dropoffAddress,
          recipientName: row.recipientName,
          recipientPhone: row.recipientPhone,
          recipientEmail: row.recipientEmail,
          loadedMiles: row.loadedMiles,
          weightLb: row.weightLb,
          additionalStops: row.additionalStops,
          serviceLevel: row.serviceLevel,
          signatureRequired: row.signatureRequired,
          proofMethod: row.proofMethod,
        })
      );
    } catch {
      /* storage unavailable: the create page simply opens blank */
    }
    router.push("/business/deliveries/new?duplicate=1");
  }

  return (
    <Stack gap={6}>
      <Cluster gap={3}>
        {mayWrite ? (
          <Link
            href="/business/deliveries/new"
            className={buttonClassName({ variant: "primary" })}
          >
            Create delivery
          </Link>
        ) : null}
      </Cluster>

      {accounts.length > 1 ? (
        <Card>
          <CardHeader title="Business account" />
          <Field label="Viewing" required>
            {(p) => (
              <Select
                {...p}
                value={businessAccountId}
                onChange={(e) => setBusinessAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.businessAccountId} value={a.businessAccountId}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Card>
      ) : null}

      {/* One filter PER state group — never a merged status dropdown. */}
      <Card>
        <CardHeader title="Find deliveries" />
        <div className="cr-mkt-price-grid">
          <Field label="Search">
            {(p) => (
              <Input
                {...p}
                value={facets.search}
                placeholder="Recipient name, phone, email"
                onChange={(e) => setFacets((f) => ({ ...f, search: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Request state">
            {(p) => (
              <Select
                {...p}
                value={facets.requestState}
                onChange={(e) => setFacets((f) => ({ ...f, requestState: e.target.value }))}
              >
                <option value="">All</option>
                {REQUEST_STATES.map((s) => (
                  <option key={s} value={s}>
                    {REQUEST_STATE_LABELS[s] ?? s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Readiness">
            {(p) => (
              <Select
                {...p}
                value={facets.readinessState}
                onChange={(e) => setFacets((f) => ({ ...f, readinessState: e.target.value }))}
              >
                <option value="">All</option>
                {READINESS_STATES.map((s) => (
                  <option key={s} value={s}>
                    {READINESS_LABEL[s] ?? s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Couranr review">
            {(p) => (
              <Select
                {...p}
                value={facets.reviewState}
                onChange={(e) => setFacets((f) => ({ ...f, reviewState: e.target.value }))}
              >
                <option value="">All</option>
                {REVIEW_STATES.map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_LABELS[s] ?? s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Payment">
            {(p) => (
              <Select
                {...p}
                value={facets.paymentState}
                onChange={(e) => setFacets((f) => ({ ...f, paymentState: e.target.value }))}
              >
                <option value="">All</option>
                <option value="none">No payment yet</option>
                {REACHABLE_PAYMENT_STATES.filter((s) => s !== "not_started").map((s) => (
                  <option key={s} value={s}>
                    {paymentLabel(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      {actionError ? (
        <ErrorState title="That could not be saved" body={actionError} />
      ) : null}

      {rowsError ? (
        <ErrorState
          title="Your deliveries did not load"
          body={withReference(rowsError)}
          action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
        />
      ) : rows === null ? (
        <LoadingState label="Loading deliveries">
          <CardSkeleton lines={5} />
        </LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No deliveries yet"
          body={
            mayWrite
              ? "Create your first delivery and Couranr will price it before anything is charged."
              : "Deliveries created for this business will appear here."
          }
          action={
            mayWrite
              ? { label: "Create delivery", href: "/business/deliveries/new" }
              : undefined
          }
        />
      ) : filtered.length === 0 && anyFacet ? (
        <EmptyState
          title="Nothing matches these filters"
          body="Clear a filter to see more deliveries."
          action={{ label: "Clear filters", onClick: () => setFacets(EMPTY_FACETS) }}
        />
      ) : (
        <Card>
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <th scope="col">Recipient</th>
                  <th scope="col">Created</th>
                  <th scope="col">Request</th>
                  <th scope="col">Readiness</th>
                  <th scope="col">Review</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Quote</th>
                  <th scope="col">
                    <span className="cr-visually-hidden-h">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const payment = payments.has(row.id) ? payments.get(row.id) ?? null : undefined;
                  const canMarkReady =
                    mayWrite &&
                    row.requestState === "confirmed" &&
                    payment === "authorized" &&
                    canChangeReadiness(row.readinessState as ReadinessState, "ready");
                  return (
                    <tr key={row.id}>
                      <td>{row.recipientName ?? "—"}</td>
                      <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                      <td>
                        <Badge tone={row.requestState === "confirmed" ? "success" : "neutral"}>
                          {REQUEST_STATE_LABELS[row.requestState] ?? row.requestState}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={READINESS_TONE[row.readinessState] ?? "neutral"}>
                          {READINESS_LABEL[row.readinessState] ?? row.readinessState}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={row.reviewState === "declined" ? "danger" : "neutral"}>
                          {REVIEW_LABELS[row.reviewState] ?? row.reviewState}
                        </Badge>
                      </td>
                      <td>
                        {payment === undefined ? (
                          <Text size="xs" muted>
                            Not checked
                          </Text>
                        ) : (
                          <Badge
                            tone={
                              payment === "authorized" || payment === "captured"
                                ? "success"
                                : payment === "failed"
                                  ? "danger"
                                  : "neutral"
                            }
                          >
                            {paymentLabel(payment)}
                          </Badge>
                        )}
                      </td>
                      <td>{formatCents(row.quote.deliverySubtotalCents)}</td>
                      <td>
                        <Cluster gap={2}>
                          <Link
                            href={`/business/deliveries/${row.id}`}
                            className={buttonClassName({ size: "sm" })}
                          >
                            Open
                          </Link>
                          {canMarkReady ? (
                            <Button
                              size="sm"
                              variant="primary"
                              loading={busyRow === row.id}
                              disabled={busyRow !== null}
                              onClick={() => markReady(row)}
                            >
                              Ready for Couranr
                            </Button>
                          ) : null}
                          {mayWrite ? (
                            <Button size="sm" variant="ghost" onClick={() => duplicate(row)}>
                              Duplicate
                            </Button>
                          ) : null}
                        </Cluster>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
          <Stack gap={1}>
            <Text size="xs" muted>
              Showing {filtered.length} of {rows.length} deliveries for {activeAccount.name}.
            </Text>
            {paymentsChecked > 0 ? (
              <Text size="xs" muted>
                Payment facts checked for the {paymentsChecked} most recently updated
                {paymentsTruncated ? "" : " open"} deliveries
                {paymentsTruncated ? " — older open deliveries are not checked here" : ""}.
                Open a delivery for its full payment record.
              </Text>
            ) : null}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
