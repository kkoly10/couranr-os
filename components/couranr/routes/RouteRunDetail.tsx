"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Card, CardHeader, Cluster, Stack, Text, buttonClassName } from "@/components/couranr/primitives";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  fetchDeliveryRequest,
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import type { RouteRunView } from "@/lib/couranr/routeRuns/types";
import { abandonRouteRun, acceptRouteRun, fetchRouteRun, saveRouteRunDraft } from "./client";

const uuid = () => crypto.randomUUID();

function addressLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Address unavailable";
  const r = value as Record<string, unknown>;
  for (const key of ["formattedAddress", "formatted_address", "displayName", "text"]) {
    if (typeof r[key] === "string" && r[key]) return String(r[key]);
  }
  const parts = [r.line1, r.line2, r.city, r.region, r.postalCode].filter((v) => typeof v === "string" && v);
  return parts.length ? parts.join(", ") : "Address unavailable";
}

async function loadStopDetails(route: RouteRunView, businessAccountId: string) {
  const results = await Promise.all(route.stops.map((stop) =>
    fetchDeliveryRequest({ id: stop.requestId, businessAccountId }),
  ));
  const details = new Map<string, DeliveryRequestView>();
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (isApiFailure(result)) return { details: new Map<string, DeliveryRequestView>(), error: withReference(result) };
    details.set(route.stops[i].requestId, result.value.request);
  }
  return { details, error: null };
}

export function RouteRunDetail({ routeRunId }: { routeRunId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState(search.get("businessAccountId") ?? "");
  const [route, setRoute] = React.useState<RouteRunView | null>(null);
  const [deliveries, setDeliveries] = React.useState<Map<string, DeliveryRequestView>>(new Map());
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"accept" | "abandon" | "revise" | null>(null);
  const acceptKey = React.useRef(uuid());
  const abandonKey = React.useRef(uuid());

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((result) => {
      if (cancelled) return;
      if (isApiFailure(result)) {
        setAccounts([]);
        setError(withReference(result));
        return;
      }
      setAccounts(result.value.businessAccounts);
      if (!businessAccountId) {
        setBusinessAccountId(result.value.businessAccounts[0]?.businessAccountId ?? "");
      }
    });
    return () => { cancelled = true; };
    // businessAccountId is intentionally read only to seed a missing query param.
    // A later account id change is owned by the route-data effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    fetchRouteRun({ businessAccountId, routeRunId }).then(async (result) => {
      if (cancelled) return;
      if (isApiFailure(result)) {
        setError(withReference(result));
        return;
      }
      const loaded = await loadStopDetails(result.value.routeRun, businessAccountId);
      if (cancelled) return;
      setError(loaded.error);
      setRoute(result.value.routeRun);
      setDeliveries(loaded.details);
    });
    return () => { cancelled = true; };
  }, [businessAccountId, routeRunId]);

  async function act(kind: "accept" | "abandon") {
    if (!route || busy || route.version !== route.currentVersion) return;
    const currentTotals = route.stops.map((stop) => deliveries.get(stop.requestId)?.quote.deliverySubtotalCents);
    if (kind === "accept" && (
      !route.stops.every((stop) => deliveries.get(stop.requestId)?.currentQuoteVersionId === stop.quoteVersionId) ||
      currentTotals.some((amount) => amount === null || amount === undefined) ||
      currentTotals.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) !== route.referenceQuoteTotalCents
    )) return;
    setBusy(kind);
    setError(null);
    const result =
      kind === "accept"
        ? await acceptRouteRun({
            businessAccountId,
            routeRunId,
            expectedVersion: route.version,
            idempotencyKey: acceptKey.current,
          })
        : await abandonRouteRun({
            businessAccountId,
            routeRunId,
            expectedVersion: route.version,
            idempotencyKey: abandonKey.current,
          });
    setBusy(null);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    setRoute(result.value.routeRun);
    router.refresh();
  }

  async function revise(requestIds: string[]) {
    if (!route || route.state !== "draft" || busy || route.version !== route.currentVersion) return;
    setBusy("revise");
    setError(null);
    setDeliveries(new Map());
    const result = await saveRouteRunDraft({
      businessAccountId,
      routeRunId,
      expectedVersion: route.version,
      idempotencyKey: uuid(),
      title: route.title,
      requestIds,
    });
    if (isApiFailure(result)) {
      setBusy(null);
      setError(withReference(result));
      return;
    }
    const loaded = await loadStopDetails(result.value.routeRun, businessAccountId);
    setDeliveries(loaded.details);
    setError(loaded.error);
    setRoute(result.value.routeRun);
    setBusy(null);
  }

  async function moveStop(index: number, delta: -1 | 1) {
    if (!route || route.state !== "draft") return;
    const target = index + delta;
    if (target < 0 || target >= route.stops.length) return;
    const requestIds = route.stops.map((stop) => stop.requestId);
    [requestIds[index], requestIds[target]] = [requestIds[target], requestIds[index]];
    await revise(requestIds);
  }

  if (accounts === null || (!route && !error)) return <LoadingState label="Loading Route Run"><CardSkeleton lines={5} /></LoadingState>;
  if (accounts.length === 0) return <EmptyState title="No business account" body="This Route Run requires a Couranr business workspace." />;
  if (error && !route) return <ErrorState title="Route Run could not load" body={error} />;
  if (!route) return null;

  const stale = route.stops.filter((s) => s.stale).length;
  const detailsReady = route.stops.every((stop) =>
    deliveries.get(stop.requestId)?.currentQuoteVersionId === stop.quoteVersionId
  ) && route.stops.every((stop) => deliveries.get(stop.requestId)?.quote.deliverySubtotalCents != null) &&
    route.stops.reduce((sum, stop) => sum + (deliveries.get(stop.requestId)?.quote.deliverySubtotalCents ?? 0), 0) === route.referenceQuoteTotalCents;
  const activeAccount = accounts.find((account) => account.businessAccountId === businessAccountId);
  const mayWrite = !!activeAccount && ["owner", "manager", "dispatcher"].includes(activeAccount.role);
  const stateLabel = route.state === "accepted" ? "Accepted" : route.state === "abandoned" ? "Archived" : "Draft";
  const stateTone = route.state === "accepted" ? "success" : route.state === "draft" ? "warning" : "neutral";

  return (
    <Stack gap={6}>
      {error ? <ErrorState title="That Route Run action could not be completed" body={error} /> : null}

      <Card>
        <CardHeader
          title={route.title}
          description="One common pickup. Every destination below remains its own Couranr delivery record."
          actions={<Badge tone={stateTone}>{stateLabel}</Badge>}
        />
        <Stack gap={3}>
          <Cluster gap={4}>
            <Text><strong>{route.stopCount}</strong> stops</Text>
            <Text><strong>{formatCents(route.referenceQuoteTotalCents)}</strong> combined delivery estimates</Text>
          </Cluster>
          <Text size="sm" muted>
            The combined number is the sum of the individual delivery estimates. It is not a discounted Route Run price.
          </Text>
          {route.state === "draft" && stale > 0 ? (
            <Alert tone="warning" title="A stop changed after this route was saved">
              Refresh or rebuild the affected delivery before accepting this Route Run.
            </Alert>
          ) : null}
          {route.state === "draft" && (!detailsReady || route.version !== route.currentVersion) ? (
            <Alert tone="warning" title="Review the current estimates">
              The displayed stop details are incomplete or no longer match this stop-set version. Refresh the stop set and review every estimate before accepting.
            </Alert>
          ) : null}
          {route.state === "accepted" ? (
            <Alert tone="info" title="Stop set frozen">
              These child deliveries are now claimed by this Route Run and cannot be submitted or changed independently. Payment, booking, driver reservation and pickup have not started.
            </Alert>
          ) : null}
          {route.state === "abandoned" ? (
            <Alert tone="info" title="Route archived">
              This draft no longer counts toward the active Route Run draft limit. Its child delivery drafts remain separate records.
            </Alert>
          ) : null}
          {route.state === "draft" && mayWrite ? (
            <Stack gap={2}>
              <Text size="sm">Accepting approves each displayed delivery estimate and their combined total for later merchant payment. You are not charged now.</Text>
              <Cluster gap={3}>
                <Button
                  variant="primary"
                  loading={busy === "accept"}
                  disabled={busy !== null || stale > 0 || !detailsReady || route.version !== route.currentVersion}
                  onClick={() => void act("accept")}
                >
                  Approve estimates and accept stops
                </Button>
                <Button
                  variant="secondary"
                  loading={busy === "revise"}
                  disabled={busy !== null || route.version !== route.currentVersion}
                  onClick={() => void revise(route.stops.map((stop) => stop.requestId))}
                >
                  Refresh stop set
                </Button>
                <Button
                  variant="ghost"
                  loading={busy === "abandon"}
                  disabled={busy !== null || route.version !== route.currentVersion}
                  onClick={() => void act("abandon")}
                >
                  Archive draft
                </Button>
              </Cluster>
              <Text size="xs" muted>
                If you re-estimate or correct a child delivery, refresh the stop set here so this draft snapshots the new child versions before acceptance.
              </Text>
            </Stack>
          ) : null}
        </Stack>
      </Card>

      <Stack gap={4}>
        {route.stops.map((stop) => {
          const delivery = deliveries.get(stop.requestId);
          return (
            <Card key={stop.requestId}>
              <CardHeader
                title={`Stop ${stop.sequence}`}
                description={delivery ? addressLabel(delivery.dropoffAddress) : "Loading delivery details…"}
                actions={
                  <Cluster gap={2}>
                    {route.state === "draft" && mayWrite ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null || stop.sequence === 1}
                          onClick={() => void moveStop(stop.sequence - 1, -1)}
                        >
                          Up
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null || stop.sequence === route.stopCount}
                          onClick={() => void moveStop(stop.sequence - 1, 1)}
                        >
                          Down
                        </Button>
                      </>
                    ) : null}
                    {stop.stale ? (
                      <Badge tone="danger">Changed</Badge>
                    ) : stop.claimed ? (
                      <Badge tone="success">Claimed</Badge>
                    ) : (
                      <Badge tone="neutral">Draft</Badge>
                    )}
                  </Cluster>
                }
              />
              <Stack gap={2}>
                <Text>{delivery?.recipientName || "Recipient name not provided"}</Text>
                <Text size="sm" muted>{delivery?.recipientEmail || "Recipient email not available"}</Text>
                {delivery?.currentQuoteVersionId === stop.quoteVersionId ? (
                  <Text size="sm">Estimate: {formatCents(delivery.quote.deliverySubtotalCents)}</Text>
                ) : <Text size="sm">Estimate needs refresh</Text>}
                <Link href={`/app/business/deliveries/${stop.requestId}`} className={buttonClassName({ size: "sm" })}>
                  Open delivery
                </Link>
              </Stack>
            </Card>
          );
        })}
      </Stack>

      <Cluster gap={3}>
        <Link href="/app/business/routes" className={buttonClassName({ variant: "ghost" })}>Back to Route Runs</Link>
      </Cluster>
    </Stack>
  );
}
