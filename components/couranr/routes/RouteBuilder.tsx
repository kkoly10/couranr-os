"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { CheckboxRow, Field, Input, Select, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState, PermissionDeniedState } from "@/components/couranr/states";
import { BusinessPlaceAutocomplete } from "@/components/couranr/requests/BusinessPlaceAutocomplete";
import {
  createDeliveryRequest,
  fetchMyBusinessAccounts,
  isApiFailure,
  newIdempotencyKey,
  saveBusinessPickupManifest,
  withReference,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import type { GoogleAddressSnapshot } from "@/lib/couranr/routing/address";
import type { RouteRunView } from "@/lib/couranr/routeRuns/types";
import { acceptRouteRun, recordBusinessDeclaredValue, saveRouteRunDraft } from "./client";

type StopDraft = {
  localId: string;
  createKey: string;
  dropoff: GoogleAddressSnapshot | null;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  weightBand: "" | "0_25_lb" | "over_25_to_50_lb";
  declaredValue: string;
  pickupDescription: string;
  packageCount: string;
  orderReference: string;
  handlingNotes: string;
  proofMethod: "photo_or_pin" | "signature";
  request: DeliveryRequestView | null;
  manifestSaved: boolean;
  valueSaved: boolean;
  currentRequestVersion: number | null;
};

const uuid = () => crypto.randomUUID();
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newStop(): StopDraft {
  return {
    localId: uuid(),
    createKey: newIdempotencyKey(),
    dropoff: null,
    recipientName: "",
    recipientEmail: "",
    recipientPhone: "",
    weightBand: "",
    declaredValue: "",
    pickupDescription: "",
    packageCount: "",
    orderReference: "",
    handlingNotes: "",
    proofMethod: "photo_or_pin",
    request: null,
    manifestSaved: false,
    valueSaved: false,
    currentRequestVersion: null,
  };
}

function cents(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(result) ? result : null;
}

function packageCount(raw: string): number | null | "invalid" {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : "invalid";
}

export function RouteBuilder() {
  const router = useRouter();
  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [pickup, setPickup] = React.useState<GoogleAddressSnapshot | null>(null);
  const [timingIntent, setTimingIntent] = React.useState<"asap" | "scheduled">("asap");
  const [requestedPickupLocal, setRequestedPickupLocal] = React.useState("");
  const [restrictedConfirmed, setRestrictedConfirmed] = React.useState(false);
  const [stops, setStops] = React.useState<StopDraft[]>(() => [newStop(), newStop()]);
  const [route, setRoute] = React.useState<RouteRunView | null>(null);
  const [busy, setBusy] = React.useState<"prepare" | "accept" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const routeRunId = React.useRef(uuid());
  const routeSaveKey = React.useRef(uuid());
  const routeAcceptKey = React.useRef(uuid());

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
      const writable = result.value.businessAccounts.find((account) =>
        ["owner", "manager", "dispatcher"].includes(account.role),
      );
      setBusinessAccountId(writable?.businessAccountId ?? result.value.businessAccounts[0]?.businessAccountId ?? "");
    });
    return () => { cancelled = true; };
  }, []);

  function patchStop(index: number, patch: Partial<StopDraft>) {
    setStops((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  function move(index: number, delta: -1 | 1) {
    setStops((rows) => {
      const target = index + delta;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function remove(index: number) {
    setStops((rows) => rows.length <= 2 ? rows : rows.filter((_, i) => i !== index));
  }
  function validate(): string | null {
    if (!businessAccountId) return "Choose a business account.";
    if (title.trim().length < 1 || title.trim().length > 100) return "Give this Route Run a short title.";
    if (!pickup) return "Choose the common pickup address from the address suggestions.";
    if (timingIntent === "scheduled" && !requestedPickupLocal) return "Choose the requested pickup date and time.";
    if (!restrictedConfirmed) return "Confirm that every package in this Route Run contains no prohibited or restricted item.";
    let aggregate = 0;
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const n = i + 1;
      if (!stop.dropoff) return `Choose the destination for stop ${n}.`;
      if (!stop.recipientName.trim()) return `Enter the recipient name for stop ${n}.`;
      if (!email.test(stop.recipientEmail.trim())) return `Enter a valid recipient email for stop ${n}.`;
      if (!stop.weightBand) return `Choose the weight range for stop ${n}.`;
      if (!stop.pickupDescription.trim()) return `Describe the package for stop ${n} so the driver can identify it at pickup.`;
      const count = packageCount(stop.packageCount);
      if (count === "invalid") return `Enter 1–9,999 packages for stop ${n}, or leave package count blank if unknown.`;
      const value = cents(stop.declaredValue);
      if (value === null || value > 50_000) return `Enter a declared value from $0 through $500 for stop ${n}.`;
      aggregate += value;
    }
    if (aggregate > 50_000) return "The combined declared value for this Route Run cannot exceed $500 at launch.";
    return null;
  }

  async function prepare() {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (!pickup || busy) return;
    setBusy("prepare");
    setError(null);

    const working = stops.map((s) => ({ ...s }));
    for (let index = 0; index < working.length; index++) {
      const stop = working[index];
      try {
        let request = stop.request;
        if (!request) {
          const created = await createDeliveryRequest({
            businessAccountId,
            idempotencyKey: stop.createKey,
            request: {
              source: "merchant_portal",
              pickupAddress: pickup,
              dropoffAddress: stop.dropoff,
              recipientName: stop.recipientName.trim(),
              recipientPhone: stop.recipientPhone.trim() || null,
              recipientEmail: stop.recipientEmail.trim(),
              weightLb: null,
              weightBand: stop.weightBand,
              restrictedClass: "none",
              timingIntent,
              requestedPickupLocal: timingIntent === "scheduled" ? requestedPickupLocal : null,
              additionalStops: 0,
              serviceLevel: "standard",
              signatureRequired: stop.proofMethod === "signature",
              proofMethod: stop.proofMethod,
              payerType: "merchant",
              readinessState: "not_confirmed",
              overnightRequested: false,
            },
          });
          if (isApiFailure(created)) throw new Error(`Stop ${index + 1}: ${withReference(created)}`);
          request = created.value.request;
          working[index] = { ...working[index], request, currentRequestVersion: request.version };
          setStops(working.map((s) => ({ ...s })));
        }

        if (!working[index].manifestSaved) {
          const count = packageCount(stop.packageCount);
          if (count === "invalid") throw new Error(`Stop ${index + 1}: package count is invalid.`);
          const manifest = await saveBusinessPickupManifest({
            id: request.id,
            businessAccountId,
            expectedManifestVersion: 0,
            manifest: {
              description: stop.pickupDescription.trim(),
              packageCount: count,
              orderReference: stop.orderReference.trim() || null,
              handlingNotes: stop.handlingNotes.trim() || null,
            },
          });
          if (isApiFailure(manifest)) throw new Error(`Stop ${index + 1}: ${withReference(manifest)}`);
          working[index] = { ...working[index], manifestSaved: true };
          setStops(working.map((s) => ({ ...s })));
        }

        if (!working[index].valueSaved) {
          const value = cents(stop.declaredValue);
          if (value === null) throw new Error(`Stop ${index + 1}: declared value is invalid.`);
          const currentVersion = working[index].currentRequestVersion ?? request.version;
          const declared = await recordBusinessDeclaredValue({
            businessAccountId,
            requestId: request.id,
            expectedVersion: currentVersion,
            declaredValueCents: value,
          });
          if (isApiFailure(declared)) throw new Error(`Stop ${index + 1}: ${withReference(declared)}`);
          working[index] = {
            ...working[index],
            valueSaved: true,
            currentRequestVersion: declared.value.version,
          };
          setStops(working.map((s) => ({ ...s })));
        }
      } catch (e) {
        setStops(working.map((s) => ({ ...s })));
        setBusy(null);
        setError(e instanceof Error ? e.message : `Stop ${index + 1} could not be prepared.`);
        return;
      }
    }

    const saved = await saveRouteRunDraft({
      businessAccountId,
      routeRunId: routeRunId.current,
      expectedVersion: 0,
      idempotencyKey: routeSaveKey.current,
      title: title.trim(),
      requestIds: working.map((s) => s.request!.id),
    });
    setBusy(null);
    if (isApiFailure(saved)) {
      setError(withReference(saved));
      return;
    }
    setStops(working);
    setRoute(saved.value.routeRun);
  }

  async function accept() {
    if (!route || busy) return;
    setBusy("accept");
    setError(null);
    const result = await acceptRouteRun({
      businessAccountId,
      routeRunId: route.routeRunId,
      expectedVersion: route.currentVersion,
      idempotencyKey: routeAcceptKey.current,
    });
    setBusy(null);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    router.push(`/app/business/routes/${result.value.routeRun.routeRunId}?businessAccountId=${businessAccountId}`);
  }
  if (accounts === null) return <LoadingState label="Loading Route Run builder"><CardSkeleton lines={5} /></LoadingState>;
  if (accounts.length === 0) {
    return <EmptyState title="No business account yet" body="Set up your business workspace before creating a Route Run." action={{ label: "Set up workspace", href: "/app/business/onboarding" }} />;
  }
  const writableAccounts = accounts.filter((account) =>
    ["owner", "manager", "dispatcher"].includes(account.role),
  );
  const hasPreparedStops = stops.some((stop) => stop.request !== null);
  if (writableAccounts.length === 0) {
    return <PermissionDeniedState action={{ label: "Back to Route Runs", href: "/app/business/routes" }} />;
  }

  if (route) {
    return (
      <Stack gap={6}>
        {error ? <ErrorState title="Route Run could not be accepted" body={error} /> : null}
        <Card>
          <CardHeader
            title="Review Route Run"
            description="The stop order and child delivery estimates below will be frozen when you accept. No payment or driver booking happens yet."
          />
          <Stack gap={3}>
            <Text><strong>{route.title}</strong></Text>
            <Text>{route.stopCount} stops · {formatCents(route.referenceQuoteTotalCents)} combined delivery estimates</Text>
            <Text size="sm" muted>
              Couranr is summing the individual delivery estimates. There is no Route Run discount in V1, and this number is not a merchandise total.
            </Text>
            <Alert tone="info" title="What acceptance does">
              Acceptance claims these exact delivery drafts so they cannot be submitted or changed separately. Payment, driver reservation, pickup and custody are still separate later steps.
            </Alert>
            {route.stops.some((s) => s.stale) ? (
              <Alert tone="warning" title="A stop changed">
                One of the child deliveries changed after the draft was created. Open that delivery and rebuild the Route Run before accepting.
              </Alert>
            ) : null}
            <Cluster gap={3}>
              <Button
                variant="primary"
                loading={busy === "accept"}
                disabled={busy !== null || route.stops.some((s) => s.stale)}
                onClick={() => void accept()}
              >
                Accept stop set
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push(`/app/business/routes/${route.routeRunId}?businessAccountId=${businessAccountId}`)}
              >
                Save as draft
              </Button>
            </Cluster>
          </Stack>
        </Card>
        <Stack gap={3}>
          {stops.map((stop, index) => (
            <Card key={stop.localId}>
              <CardHeader title={`Stop ${index + 1}`} description={stop.recipientName} />
              <Text>{stop.dropoff?.formattedAddress ?? "Destination"}</Text>
              <Text size="sm">Estimate: {formatCents(stop.request?.quote.deliverySubtotalCents ?? null)}</Text>
            </Card>
          ))}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap={6}>
      {error ? <ErrorState title="Route Run could not be prepared" body={error} /> : null}

      <Card>
        <CardHeader
          title="Route details"
          description="A Route Run is one merchant pickup with 2–5 customer destinations. Every stop remains its own delivery."
        />
        <Stack gap={4}>
          {writableAccounts.length > 1 ? (
            <Field label="Business account" required>
              {(p) => (
                <Select {...p} disabled={busy !== null || hasPreparedStops} value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)}>
                  {writableAccounts.map((a) => <option key={a.businessAccountId} value={a.businessAccountId}>{a.name}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Route title" required hint="For example: Friday local orders">
            {(p) => <Input {...p} disabled={busy !== null || hasPreparedStops} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Common pickup" required hint="All stops must leave from this exact pickup.">
            {() => busy !== null || hasPreparedStops ? (
              <Text>{pickup?.formattedAddress ?? "Prepared pickup"}</Text>
            ) : (
              <BusinessPlaceAutocomplete
                businessAccountId={businessAccountId}
                value={pickup}
                onChange={setPickup}
              />
            )}
          </Field>
          <Field label="Pickup timing" required>
            {(p) => (
              <Select {...p} disabled={busy !== null || hasPreparedStops} value={timingIntent} onChange={(e) => setTimingIntent(e.target.value as "asap" | "scheduled")}>
                <option value="asap">As soon as possible</option>
                <option value="scheduled">Requested date and time</option>
              </Select>
            )}
          </Field>
          {timingIntent === "scheduled" ? (
            <Field label="Requested pickup time" required>
              {(p) => <Input {...p} disabled={busy !== null || hasPreparedStops} type="datetime-local" value={requestedPickupLocal} onChange={(e) => setRequestedPickupLocal(e.target.value)} />}
            </Field>
          ) : null}
          <CheckboxRow
            checked={restrictedConfirmed}
            disabled={busy !== null || hasPreparedStops}
            onChange={(e) => setRestrictedConfirmed(e.target.checked)}
            label="I confirm none of the packages in this Route Run contains a prohibited or restricted item."
          />
          <Text size="sm" muted>
            Route Runs are merchant-paid in V1. Each child package must be 50 lb or less. Restricted-item review, customer-paid stops, multiple pickups and route optimization are not part of this launch flow.
          </Text>
          {hasPreparedStops ? (
            <Alert tone="info" title="Prepared details are locked">
              Couranr already created at least one child delivery draft during this attempt. Shared pickup/timing and prepared stop details stay locked so a retry cannot silently disagree with the server records.
            </Alert>
          ) : null}
        </Stack>
      </Card>
      <Stack gap={4}>
        {stops.map((stop, index) => (
          <Card key={stop.localId}>
            <CardHeader
              title={`Stop ${index + 1}`}
              description="Tell Couranr exactly which package belongs to this destination."
              actions={
                <Cluster gap={2}>
                  <Button size="sm" variant="ghost" disabled={busy !== null || index === 0} onClick={() => move(index, -1)}>Up</Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null || index === stops.length - 1} onClick={() => move(index, 1)}>Down</Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null || stops.length <= 2 || stop.request !== null} onClick={() => remove(index)}>Remove</Button>
                </Cluster>
              }
            />
            {stop.request ? (
              <Alert tone="info" title="This stop is prepared">
                Its delivery draft now exists. You may reorder the stop, but its package and recipient facts stay locked for this attempt.
              </Alert>
            ) : null}
            <Stack gap={4}>
              <Field label="Destination" required>
                {() => busy !== null || stop.request ? (
                  <Text>{stop.dropoff?.formattedAddress ?? "Prepared destination"}</Text>
                ) : (
                  <BusinessPlaceAutocomplete
                    businessAccountId={businessAccountId}
                    value={stop.dropoff}
                    onChange={(value) => patchStop(index, { dropoff: value })}
                  />
                )}
              </Field>
              <Field label="Recipient name" required>
                {(p) => <Input {...p} disabled={busy !== null || stop.request !== null} value={stop.recipientName} onChange={(e) => patchStop(index, { recipientName: e.target.value })} />}
              </Field>
              <Field label="Recipient email" required hint="Couranr uses email for tracking and handoff information.">
                {(p) => <Input {...p} disabled={busy !== null || stop.request !== null} type="email" value={stop.recipientEmail} onChange={(e) => patchStop(index, { recipientEmail: e.target.value })} />}
              </Field>
              <Field label="Recipient phone" hint="Optional unless the delivery workflow later requires it.">
                {(p) => <Input {...p} disabled={busy !== null || stop.request !== null} type="tel" value={stop.recipientPhone} onChange={(e) => patchStop(index, { recipientPhone: e.target.value })} />}
              </Field>
              <Field label="Weight range" required>
                {(p) => (
                  <Select {...p} disabled={busy !== null || stop.request !== null} value={stop.weightBand} onChange={(e) => patchStop(index, { weightBand: e.target.value as StopDraft["weightBand"] })}>
                    <option value="">Choose a range</option>
                    <option value="0_25_lb">0–25 lb</option>
                    <option value="over_25_to_50_lb">Over 25–50 lb</option>
                  </Select>
                )}
              </Field>
              <Field label="Declared shipment value" required hint="The Route Run launch limit is $500 total across all stops.">
                {(p) => <Input {...p} disabled={busy !== null || stop.request !== null} inputMode="decimal" placeholder="0.00" value={stop.declaredValue} onChange={(e) => patchStop(index, { declaredValue: e.target.value })} />}
              </Field>
              <Field label="What should the driver pick up?" required hint="Describe this stop's package, not the whole route.">
                {(p) => <Textarea {...p} disabled={busy !== null || stop.request !== null} maxLength={1000} value={stop.pickupDescription} onChange={(e) => patchStop(index, { pickupDescription: e.target.value })} />}
              </Field>
              <Field label="Package count" hint="Leave blank only if genuinely unknown.">
                {(p) => <Input {...p} disabled={busy !== null || stop.request !== null} inputMode="numeric" value={stop.packageCount} onChange={(e) => patchStop(index, { packageCount: e.target.value })} />}
              </Field>
              <Field label="Order / package reference" hint="Optional label that helps separate packages at the common pickup.">
                {(p) => <Input {...p} disabled={busy !== null || stop.request !== null} value={stop.orderReference} onChange={(e) => patchStop(index, { orderReference: e.target.value })} />}
              </Field>
              <Field label="Handling notes" hint="Optional handling instructions for this package.">
                {(p) => <Textarea {...p} disabled={busy !== null || stop.request !== null} value={stop.handlingNotes} onChange={(e) => patchStop(index, { handlingNotes: e.target.value })} />}
              </Field>
              <Field label="Recipient proof" required>
                {(p) => (
                  <Select {...p} disabled={busy !== null || stop.request !== null} value={stop.proofMethod} onChange={(e) => patchStop(index, { proofMethod: e.target.value as StopDraft["proofMethod"] })}>
                    <option value="photo_or_pin">Photo or recipient PIN</option>
                    <option value="signature">Signature</option>
                  </Select>
                )}
              </Field>
            </Stack>
          </Card>
        ))}
      </Stack>

      <Cluster gap={3}>
        {stops.length < 5 ? (
          <Button variant="secondary" disabled={busy !== null || hasPreparedStops} onClick={() => setStops((rows) => [...rows, newStop()])}>
            Add stop
          </Button>
        ) : null}
        <Button variant="primary" loading={busy === "prepare"} disabled={busy !== null} onClick={() => void prepare()}>
          Calculate delivery estimates
        </Button>
      </Cluster>
      <Text size="sm" muted>
        Couranr calculates each child delivery only when you continue. The Route Run does not make a separate optimization or pricing call in this step.
      </Text>
    </Stack>
  );
}
