"use client";

import * as React from "react";
import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Cluster,
  Grid,
  Stack,
} from "@/components/couranr/primitives";
import { CheckboxRow, Field, Input, Select, Textarea } from "@/components/couranr/forms";
import { WEIGHT_BAND_LABELS } from "@/lib/couranr/shipment/weightBandLabels";
import {
  CardSkeleton,
  ConflictState,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@/components/couranr/states";
import { QuoteSummary } from "./QuoteSummary";
import {
  createDeliveryRequest,
  estimateDeliveryRequest,
  fetchMyBusinessAccounts,
  newIdempotencyKey,
  submitDeliveryRequestFromBrowser,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "./client";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import { DUPLICATE_STORAGE_KEY } from "@/lib/couranr/requests/listFilters";
import type { GoogleAddressSnapshot } from "@/lib/couranr/routing/address";
import { GooglePlaceAutocomplete } from "./GooglePlaceAutocomplete";
import { SmartIntakePanel, type IntakeFactRow } from "./SmartIntakePanel";

/**
 * MER-005 (Create delivery) and MER-006 (Delivery review and quote) — the same
 * flow in two steps, matching the registry routes
 * `/app/business/deliveries/new` and `/app/business/deliveries/new?step=review`.
 *
 * The form collects the SHIPMENT. It has no price field and posts none: the
 * server prices the draft and the review step displays what came back. A
 * merchant cannot state an amount from this screen because there is nowhere to
 * put one.
 */

type FieldErrors = Record<string, string>;

const ERROR_COPY: Record<string, string> = {
  invalid_address: "Choose a complete street address from Google.",
  google_place_required: "Choose an address from the Google suggestions.",
  google_place_unverified: "Couranr could not verify this Google address. Choose it again.",
  weight_required: "Enter the weight, or choose the honest range.",
  weight_band_invalid: "Choose one of the weight ranges.",
  restricted_class_invalid: "Choose one of the restricted-item options.",
  timing_intent_invalid: "Choose a pickup timing.",
  requested_time_invalid: "Enter the requested pickup date and time.",
  weight_invalid: "Weight cannot be negative.",
  additional_stops_invalid: "This delivery must have one destination.",
  additional_stops_unsupported: "Create one delivery per destination.",
  recipient_email_invalid: "Enter a valid email address.",
  unknown_service_level: "Choose a service level.",
  unknown_proof_method: "Choose how delivery is proven.",
  client_supplied_amount: "This request could not be priced from your browser.",
};

function fieldErrorsFrom(details: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (!Array.isArray(details)) return out;
  for (const d of details as Array<{ code?: string; field?: string }>) {
    if (!d?.code) continue;
    const key = d.field ?? d.code;
    out[key] = ERROR_COPY[d.code] ?? "Check this value.";
  }
  return out;
}

const GOOGLE_MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/** The closed prohibited-class vocabulary, in merchant words. */
const RESTRICTED_CLASS_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["alcohol", "alcohol"],
  ["tobacco", "tobacco"],
  ["vaping_nicotine", "vape or nicotine products"],
  ["cannabis_thc", "cannabis or THC products"],
  ["firearms", "firearms"],
  ["ammunition", "ammunition"],
  ["prescription_medication", "prescription medication"],
  ["controlled_substances", "controlled substances"],
  ["fuel", "fuel"],
  ["compressed_gas", "compressed gas"],
  ["corrosive_hazmat", "corrosive materials"],
  ["toxic_hazmat", "toxic materials"],
  ["infectious_material", "infectious material"],
  ["regulated_dangerous_goods", "regulated dangerous goods"],
  ["fireworks", "fireworks"],
  ["explosives", "explosives"],
  ["illegal_goods", "illegal goods"],
  ["stolen_goods", "stolen goods"],
  ["cash", "cash"],
  ["negotiable_instruments", "checks or other negotiable instruments"],
  ["biological_specimens", "biological specimens"],
  ["live_animals", "live animals"],
  ["people", "people"],
];

export function NewDeliveryFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = searchParams.get("step") === "review" ? "review" : "intake";

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [pickup, setPickup] = React.useState<GoogleAddressSnapshot | null>(null);
  const [dropoff, setDropoff] = React.useState<GoogleAddressSnapshot | null>(null);
  const [placesReady, setPlacesReady] = React.useState(false);
  const [recipientName, setRecipientName] = React.useState("");
  const [recipientPhone, setRecipientPhone] = React.useState("");
  const [recipientEmail, setRecipientEmail] = React.useState("");
  const [weightLb, setWeightLb] = React.useState("");
  /**
   * SUR-001 band cutover. "exact" shows the pounds input; a band value says
   * the honest thing when exact pounds are not genuinely known — including
   * "unknown", which prices as Couranr review rather than as a guess.
   */
  const [weightMode, setWeightMode] = React.useState("exact");
  /**
   * The shipment-safety declaration. "unknown" until the merchant actively
   * says "none of these": an automatic price needs their affirmation, with
   * or without Smart Intake, and Couranr reviews everything else.
   */
  const [restrictedClass, setRestrictedClass] = React.useState("unknown");
  /** TMZ-001 requested timing, evaluated server-side in America/New_York. */
  const [timingIntent, setTimingIntent] = React.useState("asap");
  const [requestedPickupLocal, setRequestedPickupLocal] = React.useState("");
  const [intakeSessionId, setIntakeSessionId] = React.useState<string | null>(null);
  const [serviceLevel, setServiceLevel] = React.useState("standard");
  const [proofMethod, setProofMethod] = React.useState("photo_or_pin");
  const [readinessState, setReadinessState] = React.useState("not_confirmed");
  const [signatureRequired, setSignatureRequired] = React.useState(false);
  const [overnightRequested, setOvernightRequested] = React.useState(false);

  const [request, setRequest] = React.useState<DeliveryRequestView | null>(null);
  const [busy, setBusy] = React.useState(false);
  /**
   * MER-006's quote approval. Unticked by default and never pre-ticked: an
   * approval the merchant did not actively give is not an approval, and the
   * whole point of recording it is that Couranr can later confirm the price
   * without asking again.
   */
  const [approveQuote, setApproveQuote] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  // One key per form instance, so a double-click or a retry after a dropped
  // response reaches the same idempotent create rather than making a second
  // request.
  const idempotencyKey = React.useRef<string>("");
  if (idempotencyKey.current === "") idempotencyKey.current = newIdempotencyKey();

  /**
   * MER-004 "duplicate": prefill from the row the merchant chose, handed over
   * in sessionStorage. Applied in an effect (not in initializers) so the
   * server-rendered HTML and the first client render agree — a seeded
   * initializer would hydrate against unseeded markup. The key is removed on
   * first read, so a later plain visit starts blank. Everything here is only
   * a FORM DEFAULT: pricing happens server-side on calculate, exactly as if
   * the merchant had typed it.
   */
  const duplicateApplied = React.useRef(false);
  React.useEffect(() => {
    if (duplicateApplied.current) return;
    duplicateApplied.current = true;
    if (searchParams.get("duplicate") !== "1") return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(DUPLICATE_STORAGE_KEY);
      sessionStorage.removeItem(DUPLICATE_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let seed: any;
    try {
      seed = JSON.parse(raw);
    } catch {
      return;
    }
    const seededAddress = (v: any): GoogleAddressSnapshot | null => {
      if (
        !v ||
        typeof v !== "object" ||
        typeof v.googlePlaceId !== "string" ||
        v.addressSource !== "google_places_new"
      ) {
        return null;
      }
      return v as GoogleAddressSnapshot;
    };
    setPickup(seededAddress(seed.pickupAddress));
    setDropoff(seededAddress(seed.dropoffAddress));
    if (typeof seed.recipientName === "string") setRecipientName(seed.recipientName);
    if (typeof seed.recipientPhone === "string") setRecipientPhone(seed.recipientPhone);
    if (typeof seed.recipientEmail === "string") setRecipientEmail(seed.recipientEmail);
    if (Number.isFinite(seed.weightLb)) setWeightLb(String(seed.weightLb));
    if (typeof seed.serviceLevel === "string") setServiceLevel(seed.serviceLevel);
    if (typeof seed.proofMethod === "string") setProofMethod(seed.proofMethod);
    setSignatureRequired(seed.signatureRequired === true);
  }, [searchParams]);

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        // Same fail-closed rule as onboarding: a failed lookup leaves account
        // existence UNKNOWN, which is not the same as having none. `accounts`
        // stays null so no "no business account yet" message is shown for what
        // is actually a transient error.
        setAccountsError(r);
        if (r.status === 401) setAccounts([]);
        return;
      }
      setAccounts(r.value.businessAccounts);
      if (r.value.businessAccounts.length === 1) {
        setBusinessAccountId(r.value.businessAccounts[0].businessAccountId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * §10 prefill rule: a >=85-confidence proposal MAY prefill an EMPTY field;
   * a trusted (confirmed/overridden) fact always reflects. Nothing here
   * overwrites what the merchant already typed, and none of it is authority —
   * the server re-derives everything on calculate.
   */
  function onIntakeChange(state: { sessionId: string | null; facts: IntakeFactRow[] }) {
    setIntakeSessionId(state.sessionId);
    for (const f of state.facts) {
      const trusted = f.authority === "confirmed" || f.authority === "overridden";
      const prefillable = trusted || (f.confidence !== null && f.confidence >= 85);
      if (!prefillable) continue;
      if (f.fact_key === "weight_lb_exact" && typeof f.value === "number") {
        if (trusted || weightLb === "") {
          setWeightMode("exact");
          setWeightLb(String(f.value));
        }
      } else if (f.fact_key === "weight_band" && typeof f.value === "string" && trusted) {
        setWeightMode(f.value);
      } else if (f.fact_key === "service_level" && typeof f.value === "string" && trusted) {
        setServiceLevel(f.value);
      } else if (f.fact_key === "restricted_class" && typeof f.value === "string" && trusted) {
        // Only a TRUSTED declaration reflects; a model's "none" is never
        // pre-selected on the merchant's behalf.
        setRestrictedClass(f.value);
      }
    }
  }

  function goToStep(next: "intake" | "review") {
    router.push(next === "review" ? "?step=review" : "?step=intake", { scroll: true });
  }

  async function onCalculate(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    setFieldErrors({});
    setBusy(true);

    const payload = {
      source: "merchant_portal",
      pickupAddress: pickup,
      dropoffAddress: dropoff,
      recipientName,
      recipientPhone,
      recipientEmail,
      // Exact pounds OR a governed band — never both, never an invention.
      weightLb: weightMode === "exact" ? weightLb : null,
      weightBand: weightMode === "exact" ? null : weightMode,
      restrictedClass,
      timingIntent,
      requestedPickupLocal: timingIntent === "scheduled" ? requestedPickupLocal : null,
      additionalStops: 0,
      serviceLevel,
      signatureRequired,
      proofMethod,
      readinessState,
      overnightRequested,
    };

    const result = request
      ? await estimateDeliveryRequest({
          id: request.id,
          businessAccountId,
          expectedVersion: request.version,
          // The merchant may have edited the form since the first estimate.
          request: payload,
          intakeSessionId,
        })
      : await createDeliveryRequest({
          businessAccountId,
          request: payload,
          idempotencyKey: idempotencyKey.current,
          intakeSessionId,
        });

    setBusy(false);
    if (isApiFailure(result)) {
      setFailure(result);
      setFieldErrors(fieldErrorsFrom(result.details));
      return;
    }
    setRequest(result.value.request);
    // A fresh estimate is a fresh number. An approval given for the previous
    // price must not carry over silently onto this one, so the tick is cleared
    // and the merchant approves what they are now being shown.
    setApproveQuote(false);
    goToStep("review");
  }

  async function onSubmitForReview() {
    if (!request) return;
    setFailure(null);
    setBusy(true);
    const result = await submitDeliveryRequestFromBrowser({
      id: request.id,
      businessAccountId,
      expectedVersion: request.version,
      // Only meaningful when this business is paying and there is a priced
      // quote to approve. Sent as false otherwise so the server never records
      // an approval of a number the merchant was not shown.
      merchantAcknowledged: canAcknowledge(request) && approveQuote,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setFailure(result);
      return;
    }
    router.push(`/app/business/deliveries/${result.value.request.id}`);
  }

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
      <LoadingState label="Loading your business account">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to create a delivery"
        body="You need to be signed in to a Couranr business account."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No business account yet"
        body="Finish setting up your business account before creating a delivery."
        action={{ label: "Go to onboarding", href: "/app/business/onboarding" }}
      />
    );
  }

  /* ------------------------------------------------------------- review -- */

  if (step === "review") {
    if (!request) {
      return (
        <EmptyState
          title="Nothing to review yet"
          body="Enter the delivery details first and Couranr will calculate an estimate."
          action={{ label: "Enter details", onClick: () => goToStep("intake") }}
        />
      );
    }

    return (
      <Stack gap={6}>
        {failure?.code === "version_conflict" ? (
          <ConflictState action={{ label: "Reload", onClick: () => router.refresh() }} />
        ) : null}
        {failure && failure.code !== "version_conflict" && failure.status === 403 ? (
          <PermissionDeniedState />
        ) : null}
        {failure && failure.code !== "version_conflict" && failure.status !== 403 ? (
          <ErrorState title="This could not be submitted" body={withReference(failure)} />
        ) : null}

        <QuoteSummary request={request} />

        <Card>
          <CardHeader
            title="What happens next"
            description="Submitting sends this to Couranr review."
          />
          <ul className="cr-list">
            <li>Couranr reviews the request before any delivery is scheduled.</li>
            <li>No payment is taken when you submit.</li>
            <li>You can track the request from your deliveries list.</li>
          </ul>
        </Card>

        {/*
          MER-006 quote acknowledgment (REV-001).

          Ticking this is what lets Couranr confirm the request at this exact
          price without coming back for a second approval. Leaving it unticked
          is a supported choice, not an error: the request still submits, and
          Couranr will send it back as a revised quote for approval instead.
          That is why it is optional and unticked by default.
        */}
        {canAcknowledge(request) ? (
          <Card>
            <CardHeader
              title="Approve this estimate"
              description="Optional. It lets Couranr confirm your delivery without asking you again."
            />
            <CheckboxRow
              label="I approve this delivery estimate if Couranr confirms it without changes."
              hint={`If Couranr changes anything about the price, this approval does not apply and Couranr will send you a revised quote to approve. Estimate: ${formatCents(
                request.quote.deliverySubtotalCents
              )}.`}
              checked={approveQuote}
              onChange={(e) => setApproveQuote(e.target.checked)}
            />
          </Card>
        ) : null}

        <Cluster gap={3}>
          <Button variant="primary" loading={busy} onClick={onSubmitForReview}>
            Submit for Couranr review
          </Button>
          <Button variant="ghost" onClick={() => goToStep("intake")} disabled={busy}>
            Back to details
          </Button>
        </Cluster>
      </Stack>
    );
  }

  /* ------------------------------------------------------------- intake -- */

  return (
    <form onSubmit={onCalculate} noValidate>
      {GOOGLE_MAPS_BROWSER_KEY ? (
        <Script
          id="couranr-google-maps-places-new"
          src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
            GOOGLE_MAPS_BROWSER_KEY
          )}&v=weekly&loading=async&libraries=places`}
          strategy="afterInteractive"
          onLoad={() => setPlacesReady(true)}
          onReady={() => setPlacesReady(true)}
        />
      ) : null}
      <Stack gap={6}>
        {failure && failure.status === 403 ? <PermissionDeniedState /> : null}
        {failure && failure.status !== 403 ? (
          <ErrorState title="This could not be priced" body={withReference(failure)} />
        ) : null}

        {accounts.length > 1 ? (
          <Card>
            <CardHeader title="Business account" />
            <Field label="Delivering for" required>
              {(p) => (
                <Select
                  {...p}
                  value={businessAccountId}
                  onChange={(e) => setBusinessAccountId(e.target.value)}
                >
                  <option value="">Choose a business account</option>
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

        <AddressCard
          title="Pickup"
          value={pickup}
          onChange={setPickup}
          placesReady={placesReady}
          error={fieldErrors.pickupAddress}
        />
        <AddressCard
          title="Dropoff"
          value={dropoff}
          onChange={setDropoff}
          placesReady={placesReady}
          error={fieldErrors.dropoffAddress}
        />

        {!GOOGLE_MAPS_BROWSER_KEY ? (
          <Alert tone="warning" title="Address search is unavailable">
            Couranr needs its browser Google Maps key configured before a delivery can be
            created.
          </Alert>
        ) : null}

        <Card>
          <CardHeader title="Recipient" description="Optional. Used for delivery contact only." />
          <Grid columns={3}>
            <Field label="Name">
              {(p) => (
                <Input {...p} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
              )}
            </Field>
            <Field label="Phone">
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                />
              )}
            </Field>
            <Field label="Email" error={fieldErrors.recipientEmail}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                />
              )}
            </Field>
          </Grid>
        </Card>

        <Card>
          <CardHeader
            title="Shipment"
            description="Describe it in your own words — Couranr organizes the details, and you confirm what matters."
          />
          {businessAccountId ? (
            <SmartIntakePanel
              businessAccountId={businessAccountId}
              sessionId={intakeSessionId}
              onIntakeChange={onIntakeChange}
            />
          ) : null}
          <Grid columns={2}>
            <Field
              label="Weight"
              required
              error={fieldErrors.weightLb ?? fieldErrors.weightBand}
              hint="Exact pounds when you know them; otherwise the honest range."
            >
              {(p) => (
                <Select
                  {...p}
                  value={weightMode}
                  onChange={(e) => setWeightMode(e.target.value)}
                >
                  <option value="exact">I know the exact weight</option>
                  <option value="0_25_lb">{WEIGHT_BAND_LABELS["0_25_lb"]}</option>
                  <option value="over_25_to_50_lb">{WEIGHT_BAND_LABELS.over_25_to_50_lb}</option>
                  <option value="over_50_lb">{WEIGHT_BAND_LABELS.over_50_lb}</option>
                  <option value="unknown">Not sure yet</option>
                </Select>
              )}
            </Field>
            {weightMode === "exact" ? (
              <Field label="Weight (lb)" required error={fieldErrors.weightLb}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={weightLb}
                    onChange={(e) => setWeightLb(e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <Field label="Destinations" hint="One delivery is created per destination.">
                {(p) => <Input {...p} value="1" disabled readOnly />}
              </Field>
            )}
          </Grid>

          <Grid columns={2}>
            <Field
              label="Restricted items"
              required
              error={fieldErrors.restrictedClass}
              hint="An automatic price needs your confirmation that none of these are in the shipment. Anything else goes to Couranr review."
            >
              {(p) => (
                <Select
                  {...p}
                  value={restrictedClass}
                  onChange={(e) => setRestrictedClass(e.target.value)}
                >
                  <option value="unknown">Not sure yet — Couranr will review</option>
                  <option value="none">None of these — I confirm</option>
                  {RESTRICTED_CLASS_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      Contains: {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </Grid>

          <Grid columns={2}>
            <Field
              label="Pickup timing"
              required
              error={fieldErrors.timingIntent}
              hint="Times are Eastern (America/New_York). Same-day requests close at 4:00 PM."
            >
              {(p) => (
                <Select
                  {...p}
                  value={timingIntent}
                  onChange={(e) => setTimingIntent(e.target.value)}
                >
                  <option value="asap">As soon as possible</option>
                  <option value="scheduled">Schedule a time</option>
                </Select>
              )}
            </Field>
            {timingIntent === "scheduled" ? (
              <Field
                label="Requested pickup time"
                required
                error={fieldErrors.requestedPickupLocal}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="datetime-local"
                    value={requestedPickupLocal}
                    onChange={(e) => setRequestedPickupLocal(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
          </Grid>

          <Grid columns={3}>
            <Field label="Service level" required error={fieldErrors.serviceLevel}>
              {(p) => (
                <Select {...p} value={serviceLevel} onChange={(e) => setServiceLevel(e.target.value)}>
                  <option value="standard">Standard</option>
                  <option value="priority">Priority</option>
                  <option value="rush">Rush</option>
                </Select>
              )}
            </Field>
            <Field label="Proof of delivery" required error={fieldErrors.proofMethod}>
              {(p) => (
                <Select {...p} value={proofMethod} onChange={(e) => setProofMethod(e.target.value)}>
                  <option value="photo_or_pin">Photo or PIN</option>
                  <option value="signature">Signature</option>
                  <option value="leave_at_door">Leave at door</option>
                </Select>
              )}
            </Field>
            <Field label="Package readiness" required>
              {(p) => (
                <Select
                  {...p}
                  value={readinessState}
                  onChange={(e) => setReadinessState(e.target.value)}
                >
                  <option value="not_confirmed">Not confirmed yet</option>
                  <option value="preparing">Preparing</option>
                  <option value="ready">Ready now</option>
                  <option value="not_ready">Not ready</option>
                  <option value="unavailable">Unavailable</option>
                </Select>
              )}
            </Field>
          </Grid>

          <Stack gap={2} style={{ marginTop: "var(--couranr-space-4)" }}>
            <CheckboxRow
              label="Signature required"
              checked={signatureRequired}
              onChange={(e) => setSignatureRequired(e.target.checked)}
            />
            <CheckboxRow
              label="Request overnight"
              hint="Overnight is not offered in this release. Requesting it sends the delivery to Couranr review instead of producing an automatic estimate."
              checked={overnightRequested}
              onChange={(e) => setOvernightRequested(e.target.checked)}
            />
          </Stack>
        </Card>

        <Alert tone="info" title="Couranr calculates the price">
          Estimates are calculated by Couranr from the shipment details above.
          Nothing is charged when you submit a request.
        </Alert>

        <Cluster gap={3}>
          <Button
            variant="primary"
            type="submit"
            loading={busy}
            disabled={
              businessAccountId === "" ||
              !GOOGLE_MAPS_BROWSER_KEY ||
              !placesReady ||
              !pickup ||
              !dropoff
            }
          >
            Calculate estimate
          </Button>
          <Link className="cr-button cr-button--ghost" href="/app/business/deliveries">
            Cancel
          </Link>
        </Cluster>
      </Stack>
    </form>
  );
}

function AddressCard({
  title,
  value,
  onChange,
  placesReady,
  error,
}: {
  title: string;
  value: GoogleAddressSnapshot | null;
  onChange: (v: GoogleAddressSnapshot | null) => void;
  placesReady: boolean;
  error?: string;
}) {
  const setOptional = (key: "line2" | "instructions") =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!value) return;
      onChange({ ...value, [key]: event.target.value || null });
    };

  return (
    <Card>
      <CardHeader title={title} />
      <Stack gap={3}>
        <Field label="Search address" required error={error}>
          {() => (
            <GooglePlaceAutocomplete
              ready={placesReady}
              value={value}
              onChange={onChange}
              onInvalidSelection={() => onChange(null)}
            />
          )}
        </Field>
        {value ? (
          <Alert tone="info" title="Selected address">
            {value.formattedAddress}
          </Alert>
        ) : null}
        <Field label="Suite, unit or floor">
          {(p) => <Input {...p} value={value?.line2 ?? ""} onChange={setOptional("line2")} />}
        </Field>
        <Field label="Access notes" hint="Gate codes and door instructions. Never a password.">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={value?.instructions ?? ""}
              onChange={setOptional("instructions")}
            />
          )}
        </Field>
      </Stack>
    </Card>
  );
}

/**
 * Is there something for the merchant to approve?
 *
 * Only when this business is the payer AND the server produced an actual
 * priced estimate. A customer-paid request is not the merchant's to approve,
 * and a request headed for manual review has no number yet — offering a
 * checkbox in either case would collect an approval that means nothing and
 * that `couranr_accept_delivery_request_as_quoted` would refuse to honour.
 */
function canAcknowledge(request: DeliveryRequestView): boolean {
  return (
    request.payerType === "merchant" &&
    request.quote.status === "estimated" &&
    request.quote.deliverySubtotalCents !== null
  );
}
