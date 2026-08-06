"use client";

import * as React from "react";
import Link from "next/link";
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

/**
 * MER-005 (Create delivery with Smart Intake) and MER-006 (Delivery review and
 * quote) — the same flow in two steps, matching the registry routes
 * `/business/deliveries/new` and `/business/deliveries/new?step=review`.
 *
 * The form collects the SHIPMENT. It has no price field and posts none: the
 * server prices the draft and the review step displays what came back. A
 * merchant cannot state an amount from this screen because there is nowhere to
 * put one.
 */

type FieldErrors = Record<string, string>;

const ERROR_COPY: Record<string, string> = {
  invalid_address: "Enter a street address, city, state and ZIP.",
  loaded_miles_required: "Enter the driving distance in miles.",
  loaded_miles_invalid: "Distance cannot be negative.",
  weight_required: "Enter the package weight in pounds.",
  weight_invalid: "Weight cannot be negative.",
  additional_stops_invalid: "Enter a whole number of additional stops.",
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

const EMPTY_ADDRESS = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  instructions: "",
};

export function NewDeliveryFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = searchParams.get("step") === "review" ? "review" : "intake";

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [pickup, setPickup] = React.useState({ ...EMPTY_ADDRESS });
  const [dropoff, setDropoff] = React.useState({ ...EMPTY_ADDRESS });
  const [recipientName, setRecipientName] = React.useState("");
  const [recipientPhone, setRecipientPhone] = React.useState("");
  const [recipientEmail, setRecipientEmail] = React.useState("");
  const [loadedMiles, setLoadedMiles] = React.useState("");
  const [weightLb, setWeightLb] = React.useState("");
  const [additionalStops, setAdditionalStops] = React.useState("0");
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
    const seededAddress = (v: any) => {
      const a = { ...EMPTY_ADDRESS };
      for (const k of Object.keys(a) as (keyof typeof EMPTY_ADDRESS)[]) {
        if (v && typeof v[k] === "string") a[k] = v[k];
      }
      return a;
    };
    setPickup(seededAddress(seed.pickupAddress));
    setDropoff(seededAddress(seed.dropoffAddress));
    if (typeof seed.recipientName === "string") setRecipientName(seed.recipientName);
    if (typeof seed.recipientPhone === "string") setRecipientPhone(seed.recipientPhone);
    if (typeof seed.recipientEmail === "string") setRecipientEmail(seed.recipientEmail);
    if (Number.isFinite(seed.loadedMiles)) setLoadedMiles(String(seed.loadedMiles));
    if (Number.isFinite(seed.weightLb)) setWeightLb(String(seed.weightLb));
    if (Number.isFinite(seed.additionalStops)) setAdditionalStops(String(seed.additionalStops));
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
      loadedMiles,
      weightLb,
      additionalStops,
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
        })
      : await createDeliveryRequest({
          businessAccountId,
          request: payload,
          idempotencyKey: idempotencyKey.current,
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
    router.push(`/business/deliveries/${result.value.request.id}`);
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
        action={{ label: "Go to onboarding", href: "/business/onboarding" }}
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
          error={fieldErrors.pickupAddress}
        />
        <AddressCard
          title="Dropoff"
          value={dropoff}
          onChange={setDropoff}
          error={fieldErrors.dropoffAddress}
        />

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
            description="Couranr calculates the estimate from these details."
          />
          <Grid columns={3}>
            <Field
              label="Loaded miles"
              required
              hint="Driving distance from pickup to dropoff."
              error={fieldErrors.loadedMiles}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={loadedMiles}
                  onChange={(e) => setLoadedMiles(e.target.value)}
                />
              )}
            </Field>
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
            <Field label="Additional stops" error={fieldErrors.additionalStops}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={additionalStops}
                  onChange={(e) => setAdditionalStops(e.target.value)}
                />
              )}
            </Field>
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
            disabled={businessAccountId === ""}
          >
            Calculate estimate
          </Button>
          <Link className="cr-button cr-button--ghost" href="/business/deliveries">
            Cancel
          </Link>
        </Cluster>
      </Stack>
    </form>
  );
}

type AddressValue = typeof EMPTY_ADDRESS;

function AddressCard({
  title,
  value,
  onChange,
  error,
}: {
  title: string;
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  error?: string;
}) {
  const set = (k: keyof AddressValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });

  return (
    <Card>
      <CardHeader title={title} />
      <Stack gap={3}>
        <Field label="Street address" required error={error}>
          {(p) => <Input {...p} value={value.line1} onChange={set("line1")} />}
        </Field>
        <Field label="Suite, unit or floor">
          {(p) => <Input {...p} value={value.line2} onChange={set("line2")} />}
        </Field>
        <Grid columns={3}>
          <Field label="City" required>
            {(p) => <Input {...p} value={value.city} onChange={set("city")} />}
          </Field>
          <Field label="State" required>
            {(p) => <Input {...p} value={value.region} onChange={set("region")} />}
          </Field>
          <Field label="ZIP" required>
            {(p) => <Input {...p} value={value.postalCode} onChange={set("postalCode")} />}
          </Field>
        </Grid>
        <Field label="Access notes" hint="Gate codes and door instructions. Never a password.">
          {(p) => <Textarea {...p} rows={2} value={value.instructions} onChange={set("instructions")} />}
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
