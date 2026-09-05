"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
  buttonClassName,
} from "@/components/couranr/primitives";
import { Field, Select } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  call,
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import { memberMay } from "@/lib/couranr/settings/permissions";
import {
  CHARGE_RECORD_DESCRIPTIONS,
  CHARGE_RECORD_LABELS,
  CHARGE_RECORD_TONE,
  formatCents,
  moneyWasTaken,
  type BillingView,
  type ChargeRecordState,
} from "@/lib/couranr/billing/records";

/**
 * MER-016 — billing records.
 *
 * The registry's constraint on this screen is "no monthly subscription
 * invoice during pilot; separate delivery charge from product sale", and
 * REF-002 makes the second half a hard copy rule: Couranr charges for
 * delivery, the merchant owns the product price and any refund of it. Every
 * total on this page is a DELIVERY charge and says so.
 *
 * Two of the four registry-required states are reachable and rendered from
 * real rows — no payment method, and payment failed. The other two are named
 * as gaps with what a merchant should do instead, rather than drawn as
 * controls that do nothing. `lib/couranr/billing/records.ts` carries the
 * citation for each.
 */

function alertTone(state: ChargeRecordState): "info" | "success" | "warning" | "danger" {
  const t = CHARGE_RECORD_TONE[state];
  return t === "neutral" ? "info" : t;
}

function fetchBilling(businessAccountId: string) {
  return call<{ billing: BillingView }>(
    `/api/couranr/merchant/billing?businessAccountId=${encodeURIComponent(businessAccountId)}`
  );
}

export function BillingRecords() {
  const router = useRouter();

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [view, setView] = React.useState<BillingView | null>(null);
  const [viewError, setViewError] = React.useState<ApiFailure | null>(null);
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
    setView(null);
    setViewError(null);
    fetchBilling(businessAccountId).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setViewError(r);
        return;
      }
      setView(r.value.billing);
    });
    return () => {
      cancelled = true;
    };
  }, [businessAccountId, reloadKey]);

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
      <LoadingState label="Loading your billing records">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }
  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to see your billing"
        body="You need to be signed in to a Couranr business account."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No business account yet"
        body="Set up your business workspace first."
        action={{ label: "Set up your workspace", href: "/app/business/onboarding" }}
      />
    );
  }

  const activeAccount =
    accounts.find((a) => a.businessAccountId === businessAccountId) ?? accounts[0];
  const mayRead = memberMay({ role: activeAccount.role, status: "active" }, "billing.read");

  if (!mayRead) {
    return (
      <EmptyState
        title="You do not have access to billing"
        body="Billing records are visible to owners, managers and billing contacts. Ask one of them if you need a charge."
      />
    );
  }

  return (
    <Stack gap={6}>
      {accounts.length > 1 ? (
        <Card>
          <CardHeader title="Business account" />
          <Field label="Viewing" required>
            {(p) => (
              <Select
                {...p}
                value={activeAccount.businessAccountId}
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

      {viewError ? (
        <ErrorState
          title="Your billing records did not load"
          body={withReference(viewError)}
          action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
        />
      ) : null}

      {!view && !viewError ? (
        <LoadingState label="Loading your billing records">
          <CardSkeleton lines={5} />
        </LoadingState>
      ) : null}

      {view ? (
        <>
          {/*
            Required state: NO PAYMENT METHOD. Universally true today, and
            said as a fact about how Couranr works rather than as a task the
            merchant has failed to complete — there is no control anywhere
            that would let them complete it.
          */}
          {view.paymentMethod === "none_on_file" ? (
            <Alert tone="info" title="No stored payment method">
              Couranr does not store a payment method yet. For business-paid
              deliveries, an authorized business user confirms payment on that
              delivery. Customer-paid deliveries use the customer&apos;s own secure
              payment link. Nothing is charged until Couranr confirms service.
            </Alert>
          ) : null}

          <Card>
            <CardHeader
              title="Delivery charges"
              description="Delivery charges Couranr processed for this business, with the payer identified on every row. The price of what you sold is yours and never appears here."
              actions={
                <Text size="sm">
                  <strong>{formatCents(view.totalChargedCents)}</strong>{" "}
                  {view.totalIsComplete ? "charged" : "charged so far"}
                </Text>
              }
            />
            {/*
              The total covers everything; the LIST does not. Saying which is
              which is the whole point — a page that shows 100 of 340 charges
              under a complete-looking total invites a merchant to conclude
              the total is the sum of what they can see.
            */}
            {view.recordCount > view.records.length ? (
              <Alert tone="info" title="Showing your most recent charges">
                {view.records.length} of {view.recordCount} charges are listed
                below. The total above covers all {view.recordCount}.
              </Alert>
            ) : null}
            {!view.totalIsComplete ? (
              <Alert tone="warning" title="This total is incomplete">
                You have more charges than Couranr can total on this page.
                Message Couranr Support for a full statement.
              </Alert>
            ) : null}
            {view.records.length === 0 ? (
              <EmptyState
                title="Nothing has been charged yet"
                body="Delivery charges appear here once the selected payer authorizes a delivery."
                action={{ label: "Create a delivery", href: "/app/business/deliveries/new" }}
              />
            ) : (
              <Stack gap={4}>
                {view.records.map((r) => {
                  const taken = moneyWasTaken(r.state);
                  return (
                    <Stack key={r.obligationId} gap={1}>
                      <Cluster gap={2}>
                        <Badge tone={CHARGE_RECORD_TONE[r.state] ?? "neutral"}>
                          {CHARGE_RECORD_LABELS[r.state] ?? r.state}
                        </Badge>
                        <Text size="sm">
                          <strong>
                            {formatCents(
                              taken ? (r.capturedAmountCents ?? r.amountCents) : r.amountCents,
                              r.currency
                            )}
                          </strong>
                        </Text>
                        <Text size="sm" muted>
                          {r.recipientName || "No recipient name"}
                        </Text>
                      </Cluster>
                      <Text size="sm" muted>
                        {CHARGE_RECORD_DESCRIPTIONS[r.state] ?? ""}
                      </Text>
                      <Cluster gap={2}>
                        <Text size="xs" muted>
                          {new Date(r.createdAt).toLocaleDateString()} ·{" "}
                          {r.payerType === "customer" ? "Customer paid" : "You paid"}
                        </Text>
                        <Link
                          href={`/app/business/deliveries/${encodeURIComponent(r.requestId)}`}
                          className={buttonClassName({ size: "sm" })}
                        >
                          Open delivery
                        </Link>
                      </Cluster>
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </Card>

          {/*
            Required state: PAYMENT FAILED, surfaced as its own call to action
            rather than only as a row badge — a failed authorization stops a
            delivery being dispatched, which is the one thing on this page a
            merchant has to act on.

            Driven by `failedCount`, which the server computes over EVERY row.
            It used to read `records.some(...)` — the listed PAGE — so a
            merchant whose failure was older than their most recent hundred
            charges saw nothing at all about the delivery that was stuck.
          */}
          {view.failedCount > 0 ? (
            <Alert
              tone={alertTone("failed")}
              title={
                view.failedCount === 1
                  ? "A payment did not go through"
                  : `${view.failedCount} payments did not go through`
              }
            >
              {CHARGE_RECORD_DESCRIPTIONS.failed}{" "}
              {view.records.some((r) => r.state === "failed")
                ? "Open the delivery above to restore the required payer authorization."
                : "The affected deliveries are older than the charges listed above. Open them from your deliveries list to restore the required payer authorization."}
            </Alert>
          ) : null}

          <Card>
            <CardHeader
              title="What Couranr cannot do here yet"
              description="Said plainly rather than shown as a button that does nothing."
            />
            <Stack gap={3}>
              {view.gaps.map((g) => (
                <Stack key={g.id} gap={1}>
                  <Text size="sm">
                    <strong>{g.label}</strong>
                  </Text>
                  <Text size="sm" muted>
                    {g.merchantCopy}
                  </Text>
                </Stack>
              ))}
              <div>
                <Link href="/app/business/messages" className={buttonClassName({ size: "sm" })}>
                  Message Couranr Support
                </Link>
              </div>
            </Stack>
          </Card>
        </>
      ) : null}
    </Stack>
  );
}
