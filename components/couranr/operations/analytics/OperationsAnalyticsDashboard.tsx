"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { Field, Select } from "@/components/couranr/forms";
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from "@/components/couranr/states";
import {
  call,
  isApiFailure,
  withReference,
  type ApiFailure,
} from "@/components/couranr/requests/client";
import { formatCents } from "@/lib/couranr/requests/view";
import {
  CATEGORY_LABELS,
  MARKET_LABELS,
  type CountBucket,
  type MoneyBucket,
  type OperationsAnalytics,
  type Panel,
  type UnmetDemandAnalytics,
} from "@/lib/couranr/operations/analyticsTypes";

/**
 * OPS-013 Operations analytics and OPS-014 Unmet demand analytics.
 *
 * ONE route, two tabs, selected by `?tab=` — the canonical route shape the
 * screen registry declares for OPS-014 (`/operations/analytics?tab=unmet-demand`).
 * The URL is the state: the filters live there too, so a filtered view is a
 * link an Operations user can hand to a colleague, and browser back works.
 *
 * Nothing on this screen is computed in the browser. Every figure arrives from
 * the aggregation in `lib/couranr/operations/analytics.ts`, which derives it
 * from a canonical table. There is no fallback that renders a zero: a panel
 * with nothing measured renders EMPTY, a panel whose measure has no source
 * column renders NOT MEASURABLE with its reason, and a failed read renders an
 * error — never a number.
 */

const TAB_OVERVIEW = "overview";
const TAB_UNMET = "unmet-demand";

type TabId = typeof TAB_OVERVIEW | typeof TAB_UNMET;

const DAY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All recorded history" },
];

export function OperationsAnalyticsDashboard() {
  const router = useRouter();
  const params = useSearchParams();

  const tab: TabId = params.get("tab") === TAB_UNMET ? TAB_UNMET : TAB_OVERVIEW;
  const days = params.get("days") ?? "30";
  const market = params.get("market") ?? "";
  const category = params.get("category") ?? "";
  const payer = params.get("payer") ?? "";

  const query = React.useMemo(() => {
    const q = new URLSearchParams();
    q.set("days", days);
    if (market) q.set("market", market);
    if (category) q.set("category", category);
    if (payer) q.set("payer", payer);
    return q.toString();
  }, [days, market, category, payer]);

  const setParam = React.useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/operations/analytics?${next.toString()}`, { scroll: false });
    },
    [params, router]
  );

  return (
    <Stack gap={6}>
      <div className="cr-tabs__list" role="tablist" aria-label="Analytics views">
        <TabButton id={TAB_OVERVIEW} active={tab} label="Delivery analytics" onSelect={setParam} />
        <TabButton id={TAB_UNMET} active={tab} label="Unmet demand" onSelect={setParam} />
      </div>

      <Filters
        days={days}
        market={market}
        category={category}
        payer={payer}
        onChange={setParam}
      />

      <div
        role="tabpanel"
        id={`cr-panel-${tab}`}
        aria-labelledby={`cr-tab-${tab}`}
        className="cr-tabs__panel"
      >
        {tab === TAB_UNMET ? <UnmetDemandTab query={query} /> : <OverviewTab query={query} />}
      </div>
    </Stack>
  );
}

function TabButton({
  id,
  active,
  label,
  onSelect,
}: {
  id: TabId;
  active: TabId;
  label: string;
  onSelect: (key: string, value: string) => void;
}) {
  const selected = id === active;
  return (
    <button
      type="button"
      role="tab"
      id={`cr-tab-${id}`}
      aria-selected={selected}
      aria-controls={`cr-panel-${id}`}
      tabIndex={selected ? 0 : -1}
      className="cr-tabs__tab"
      onClick={() => onSelect("tab", id === TAB_OVERVIEW ? "" : id)}
    >
      {label}
    </button>
  );
}

function Filters({
  days,
  market,
  category,
  payer,
  onChange,
}: {
  days: string;
  market: string;
  category: string;
  payer: string;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Filter"
        description="Filters are part of the URL, so a filtered view is a link you can share."
      />
      <div className="cr-ops-analytics-filters">
        <Field id="cr-an-days" label="Period" optionalLabel="all periods">
          {(field) => (
            <Select {...field} value={days} onChange={(e) => onChange("days", e.target.value)}>
              {DAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="cr-an-market" label="Market" optionalLabel="all markets">
          {(field) => (
            <Select {...field} value={market} onChange={(e) => onChange("market", e.target.value)}>
              <option value="">All markets</option>
              {Object.entries(MARKET_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="cr-an-category" label="Business category" optionalLabel="all categories">
          {(field) => (
            <Select
              {...field}
              value={category}
              onChange={(e) => onChange("category", e.target.value)}
            >
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="cr-an-payer" label="Payer" optionalLabel="both payers">
          {(field) => (
            <Select {...field} value={payer} onChange={(e) => onChange("payer", e.target.value)}>
              <option value="">Both payers</option>
              <option value="merchant">Merchant pays</option>
              <option value="customer">Customer pays</option>
            </Select>
          )}
        </Field>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- data hook */

function useAnalytics<T>(path: string, unwrap: (payload: any) => T) {
  const [value, setValue] = React.useState<T | null>(null);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const result = await call<any>(path);
    if (isApiFailure(result)) {
      setFailure(result);
      setValue(null);
      setLoading(false);
      return;
    }
    setFailure(null);
    /* Every canonical route nests its payload under a named key. Reading it
       flat is invisible to `tsc` — the routes return untyped JSON — and the
       failure is silent, which is how proof upload was dead for its whole
       life. `unwrap` names the key once, here. */
    setValue(unwrap(result.value) ?? null);
    setLoading(false);
  }, [path, unwrap]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return { value, failure, loading, reload: load };
}

/* -------------------------------------------------------------- OPS-013 tab */

function OverviewTab({ query }: { query: string }) {
  const unwrap = React.useCallback((p: any) => p?.analytics as OperationsAnalytics, []);
  const { value, failure, loading, reload } = useAnalytics<OperationsAnalytics>(
    `/api/couranr/operations/analytics?${query}`,
    unwrap
  );

  if (loading && !value) {
    return (
      <LoadingState label="Loading Operations analytics">
        <Card>
          <CardHeader title="Delivery analytics" description="Measuring canonical delivery evidence." />
        </Card>
      </LoadingState>
    );
  }
  if (failure?.status === 401 || failure?.status === 403) return <PermissionDeniedState />;
  if (failure || !value) {
    return (
      <ErrorState
        title="Analytics could not be loaded"
        body={failure ? withReference(failure) : "No measurement was returned."}
        action={{ label: "Retry", onClick: reload }}
      />
    );
  }

  if (value.state === "empty") {
    return (
      <EmptyState
        title="Nothing has been measured yet"
        body="No delivery request, delivery, payment or support record falls in this period, so there is nothing to measure. This is an empty period, not a set of zeros."
      />
    );
  }

  const e = value.economics;

  return (
    <Stack gap={6}>
      <TruncationNotice sources={value.truncatedSources} />

      <Card>
        <CardHeader
          title="Paid deliveries and economics"
          description="A payment authorization is a hold, not revenue. Only a capture is counted here, and every figure is summed from canonical payment obligations."
          actions={<ExportButton name="couranr-analytics" data={value} />}
        />
        <div className="cr-ops-metrics" aria-label="Paid delivery and economic summary">
          <Metric label="Paid deliveries" value={String(value.paidDeliveries.count)} />
          <Metric label="Captured" value={formatCents(e.capturedCents)} />
          <Metric label="Refunded" value={formatCents(e.refundedCents)} />
          <Metric label="Net captured" value={formatCents(e.netCapturedCents)} />
          <Metric
            label="Average per paid delivery"
            value={e.averageCapturedCents === null ? "Not measured" : formatCents(e.averageCapturedCents)}
          />
          <Metric label="Promotional credit" value={formatCents(e.promotionalCreditCents)} />
          <Metric label="Requests in period" value={String(value.requestsInWindow)} />
        </div>
      </Card>

      <PanelCard
        title="Paid deliveries by fulfillment state"
        description="Where the deliveries Couranr has actually been paid for currently stand."
        panel={value.paidDeliveries.byFulfillmentState}
      />

      <MoneyPanelCard
        title="Markets"
        description="Classified from the pickup address by the launch-market classifier. The verdict crosses into analytics; the address does not."
        panel={value.markets}
      />

      <MoneyPanelCard
        title="Business categories"
        description="The merchant workspace category behind each request."
        panel={value.categories}
      />

      <MoneyPanelCard
        title="Payer mix"
        description="Who owes Couranr for the delivery, counted from payment obligations."
        panel={value.payerMix}
      />

      <MoneyPanelCard
        title="Requester mix"
        description="Whether the request came from a business or a consumer."
        panel={value.requesterMix}
      />

      <Card>
        <CardHeader
          title="Support"
          description="Conversations, customer problem reports and delivery incidents. Counts and governed types only — no message body and no report detail reaches this surface."
        />
        <Stack gap={4}>
          <div className="cr-ops-metrics" aria-label="Support summary">
            <Metric label="Conversations" value={String(totalOf(value.support.conversations))} />
            <Metric label="Past due" value={String(value.support.overdueConversations)} />
            <Metric label="Problem reports" value={String(totalOf(value.support.problemReports))} />
            <Metric label="Incidents" value={String(totalOf(value.support.incidents))} />
          </div>
          <BucketTable caption="Conversations by kind" panel={value.support.conversations} />
          <BucketTable caption="Conversations by due state" panel={value.support.conversationsByDueState} />
          <BucketTable caption="Problem reports by type" panel={value.support.problemReports} />
          <BucketTable caption="Incidents by type" panel={value.support.incidents} />
        </Stack>
      </Card>

      <Card>
        <CardHeader
          title="Proof"
          description="Proof coverage counted from the proof records themselves. No object path, no bucket name, no signed URL and no capture coordinate is read."
        />
        <Stack gap={4}>
          <div className="cr-ops-metrics" aria-label="Proof coverage summary">
            <Metric label="Delivered with dropoff proof" value={String(value.proof.deliveredWithDropoffProof)} />
            <Metric label="Delivered without" value={String(value.proof.deliveredWithoutDropoffProof)} />
          </div>
          <BucketTable caption="Proof by stage" panel={value.proof.byStage} />
          <BucketTable caption="Proof by type" panel={value.proof.byType} />
        </Stack>
      </Card>

      <Card>
        <CardHeader
          title="Driver utilization"
          description="Assignment counts by driver id. Driver names and contact details are deliberately not read; the id is what opens the driver on its own Operations surface."
        />
        <Stack gap={4}>
          <div className="cr-ops-metrics" aria-label="Driver utilization summary">
            <Metric label="Active drivers" value={String(value.driverUtilization.activeDrivers)} />
            <Metric label="Drivers with assignments" value={String(value.driverUtilization.driversWithAssignments)} />
          </div>
          <BucketTable caption="Assignments by state" panel={value.driverUtilization.assignmentsByState} />
          <BucketTable caption="Assignments per driver" panel={value.driverUtilization.perDriver} />
          <BucketTable caption="Utilization rate" panel={value.driverUtilization.utilizationRate} />
        </Stack>
      </Card>

      <GeneratedAt at={value.generatedAt} />
    </Stack>
  );
}

/* -------------------------------------------------------------- OPS-014 tab */

function UnmetDemandTab({ query }: { query: string }) {
  const unwrap = React.useCallback((p: any) => p?.unmetDemand as UnmetDemandAnalytics, []);
  const { value, failure, loading, reload } = useAnalytics<UnmetDemandAnalytics>(
    `/api/couranr/operations/analytics/unmet-demand?${query}`,
    unwrap
  );

  if (loading && !value) {
    return (
      <LoadingState label="Loading unmet demand">
        <Card>
          <CardHeader title="Unmet demand" description="Reading recorded could-not-confirm reasons." />
        </Card>
      </LoadingState>
    );
  }
  if (failure?.status === 401 || failure?.status === 403) return <PermissionDeniedState />;
  if (failure || !value) {
    return (
      <ErrorState
        title="Unmet demand could not be loaded"
        body={failure ? withReference(failure) : "No measurement was returned."}
        action={{ label: "Retry", onClick: reload }}
      />
    );
  }

  if (value.state === "empty") {
    return (
      <EmptyState
        title="No requests in this period"
        body="There is no delivery request in this period at all, so there is no demand to analyse — met or unmet."
      />
    );
  }

  const u = value.universe;

  return (
    <Stack gap={6}>
      <TruncationNotice sources={value.truncatedSources} />

      <Alert tone="info" title="These are requests, not lost customers">
        <Text size="sm">
          A request Couranr did not confirm is not the same thing as a customer Couranr lost. A draft
          nobody submitted was never put to Couranr; a request still in review has not been refused;
          a request the customer cancelled, one outside the service area and one Couranr declined are
          three different facts. They are counted separately below and are never summed into a single
          number.
        </Text>
      </Alert>

      <Card>
        <CardHeader
          title="What happened to every request in this period"
          description="The four outcomes are disjoint and only the last one is unmet demand."
          actions={<ExportButton name="couranr-unmet-demand" data={value} />}
        />
        <div className="cr-ops-metrics" aria-label="Request outcome summary">
          <Metric label="Confirmed" value={String(u.confirmed)} />
          <Metric label="Never submitted" value={String(u.neverSubmitted)} />
          <Metric label="Still open" value={String(u.stillOpen)} />
          <Metric label="Could not confirm" value={String(u.couldNotConfirm)} />
        </div>
        <Stack gap={2} style={{ marginTop: "var(--couranr-space-4)" }}>
          <Text size="sm" muted>
            Never submitted — a draft or a request awaiting the merchant&apos;s own confirmation.
            Couranr was never asked, so it could not have confirmed or refused.
          </Text>
          <Text size="sm" muted>
            Still open — awaiting quote acceptance, in Couranr review, or awaiting a quote revision.
            Nothing has been refused.
          </Text>
        </Stack>
      </Card>

      {u.couldNotConfirm === 0 ? (
        <EmptyState
          title="Couranr did not fail to confirm anything in this period"
          body="No request in this period reached declined, cancelled or closed."
        />
      ) : (
        <>
          <Card>
            <CardHeader
              title="Why Couranr could not confirm"
              description="From the recorded reason only. A decline carries a governed couranr-decline-v1 code; a cancellation's reason is free text and is deliberately not read, so a cancellation is attributed to the actor who cancelled, which is recorded."
              actions={
                value.unattributed > 0 ? (
                  <Badge tone="warning">{value.unattributed} not attributed</Badge>
                ) : null
              }
            />
            <BucketTable caption="Recorded cause" panel={value.causes} />
            {value.unattributed > 0 ? (
              <Text size="sm" muted style={{ marginTop: "var(--couranr-space-3)" }}>
                {value.unattributed} of these requests carry no recorded terminal reason at all. They
                are shown as unattributed and are not assigned to any cause.
              </Text>
            ) : null}
          </Card>

          <PanelCard
            title="Service-area disposition"
            description="Where the service-area review stood. Independent of the cause above: a request can be outside the area AND cancelled, so these two tables must not be added together."
            panel={value.serviceArea}
          />

          <PanelCard
            title="Quote disposition"
            description="Whether a quote had been produced automatically, needed a manual one, or was invalid."
            panel={value.quoteDisposition}
          />

          <PanelCard
            title="Review triggers"
            description="Why the pricing engine sent the request to review."
            panel={value.reviewTriggers}
          />

          <PanelCard
            title="Timing triggers"
            description="Why the requested timing needed Couranr review."
            panel={value.timingTriggers}
          />

          <PanelCard title="Markets" description="Classified from the pickup address; the address itself is never read into this surface." panel={value.markets} />
          <PanelCard title="Business categories" panel={value.categories} />
          <PanelCard title="Distance" description="Banded on the Couranr Pricing Authority V2 boundaries." panel={value.distanceBands} />

          <Card>
            <CardHeader
              title="Vehicle need"
              description="What an unconfirmed request records about what it would have taken to carry."
            />
            <Stack gap={4}>
              <Alert tone="info" title="A vehicle class was never assigned">
                <Text size="sm">
                  A vehicle requirement is produced at planning time, which by definition never
                  happened for a request Couranr could not confirm. What these requests do record is
                  the declared weight band and the restricted class, which is what a vehicle decision
                  would have been made from.
                </Text>
              </Alert>
              <BucketTable caption="Declared weight band" panel={value.weightBands} />
              <BucketTable caption="Restricted class" panel={value.restrictedClasses} />
            </Stack>
          </Card>

          <PanelCard title="By day" description="Could-not-confirm requests by the day they were created." panel={value.byDay} />

          <Card>
            <CardHeader
              title="Open the underlying requests"
              description="Ids only. Open a request on its own Operations surface, which authorizes its own reader — no request content is reproduced here."
            />
            {value.recent.length === 0 ? (
              <div className="cr-ops-ready-state">
                <Text strong>Nothing to open.</Text>
              </div>
            ) : (
              <div className="cr-ops-attention-list">
                {value.recent.map((r) => (
                  <Link
                    key={r.requestId}
                    href={`/operations/deliveries/${r.requestId}#ops-current-action`}
                    className="cr-ops-attention"
                  >
                    <div className="cr-ops-attention__main">
                      <Cluster gap={2}>
                        <Badge tone="neutral">{r.requestState.replace(/_/g, " ")}</Badge>
                        <Text size="xs" muted>
                          {causeLabel(value.causes, r.cause)}
                        </Text>
                      </Cluster>
                      <Text size="sm" muted>Request {r.requestId.slice(0, 8)}…</Text>
                    </div>
                    <div className="cr-ops-attention__aside">
                      <Text size="xs" muted>{formatDay(r.createdAt)}</Text>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <GeneratedAt at={value.generatedAt} />
    </Stack>
  );
}

/* ------------------------------------------------------------------- pieces */

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cr-ops-metric">
      <span className="cr-ops-metric__top">
        <span>{label}</span>
      </span>
      <span className="cr-ops-metric__value">{value}</span>
    </div>
  );
}

function totalOf(panel: Panel<CountBucket>): number {
  return panel.rows.reduce((a, b) => a + b.count, 0);
}

function causeLabel(panel: Panel<CountBucket>, key: string): string {
  return panel.rows.find((r) => r.key === key)?.label ?? key.replace(/_/g, " ");
}

function formatDay(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}

function PanelCard({
  title,
  description,
  panel,
}: {
  title: string;
  description?: string;
  panel: Panel<CountBucket>;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <BucketTable caption={title} panel={panel} />
    </Card>
  );
}

function MoneyPanelCard({
  title,
  description,
  panel,
}: {
  title: string;
  description?: string;
  panel: Panel<MoneyBucket>;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <BucketTable caption={title} panel={panel} money />
    </Card>
  );
}

/**
 * The one place a bucket is rendered, so every panel state is handled once.
 *
 * `not_measurable` is rendered as itself — the measure and the reason it
 * cannot be derived — rather than as a table of zeros. That distinction is the
 * whole point: a zero asserts a measurement was taken.
 */
function BucketTable({
  caption,
  panel,
  money,
}: {
  caption: string;
  panel: Panel<CountBucket | MoneyBucket>;
  money?: boolean;
}) {
  if (panel.state === "not_measurable") {
    return (
      <div className="cr-ops-ready-state">
        <Text strong>Not measurable yet</Text>
        <Text muted size="sm">{panel.reason}</Text>
      </div>
    );
  }
  if (panel.state === "empty") {
    return (
      <div className="cr-ops-ready-state">
        <Text strong>Nothing measured in this period.</Text>
        <Text muted size="sm">
          No record in this period carries this measure. That is an empty period, not a zero.
        </Text>
      </div>
    );
  }

  const total = panel.rows.reduce((a, b) => a + b.count, 0);

  return (
    <Stack gap={2}>
      <div className="cr-table-scroll" tabIndex={0} role="region" aria-label={caption}>
        <table className="cr-table cr-table--numeric">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Count</th>
              {money ? <th scope="col">Captured</th> : null}
            </tr>
          </thead>
          <tbody>
            {panel.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{row.count}</td>
                {money ? <td>{formatCents((row as MoneyBucket).capturedCents)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {panel.multiValued ? (
        <Text size="xs" muted>
          A request can carry more than one of these, so these counts total {total} and do not add up
          to the number of requests.
        </Text>
      ) : null}
      {panel.state === "partial" && panel.unattributed ? (
        <Text size="xs" muted>
          Partial attribution: {panel.unattributed} record(s) could not be attributed and are shown
          as their own row rather than folded into a cause.
        </Text>
      ) : null}
    </Stack>
  );
}

function TruncationNotice({ sources }: { sources: string[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <Alert tone="warning" title="These counts are a floor, not a total">
      <Text size="sm">
        {sources.join(", ")} reached the per-source row limit for this period, so every figure drawn
        from them understates the real number. Narrow the period to measure it exactly.
      </Text>
    </Alert>
  );
}

function GeneratedAt({ at }: { at: string }) {
  if (!at) return null;
  return (
    <Text size="xs" muted>
      Measured at {new Date(at).toLocaleString()} from canonical Couranr records.
    </Text>
  );
}

/**
 * "Export privacy-safe aggregates."
 *
 * Exports the aggregate object this screen is already showing, and nothing
 * else. There is no row-level export path on this surface at all: the payload
 * contains only counts, integer cents, UUIDs and ISO timestamps, so the export
 * cannot carry what the screen cannot show.
 */
function ExportButton({ name, data }: { name: string; data: unknown }) {
  const onClick = React.useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [data, name]);

  return (
    <Button variant="secondary" onClick={onClick}>
      Export aggregates
    </Button>
  );
}
