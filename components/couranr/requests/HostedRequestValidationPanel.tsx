"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Grid, Stack, Text } from "@/components/couranr/primitives";
import { CheckboxRow, Field, Input, Select, Textarea } from "@/components/couranr/forms";
import { ErrorState } from "@/components/couranr/states";
import type { DeliveryRequestView } from "@/lib/couranr/requests/view";
import type { RestrictedClassDeclaration } from "@/lib/couranr/shipment/facts";
import {
  isApiFailure,
  validateHostedRequestFromBrowser,
  withReference,
} from "@/components/couranr/requests/client";

type Context = {
  orderReference: string | null;
  requestedPayerType: "merchant" | "customer" | null;
  destinationLabel: string | null;
  shipmentDescription: string | null;
  customerPackageCount: number | null;
  pickupManifestVersion: number;
  customerWeightLb: number | null;
  customerWeightBand: string | null;
  customerRestrictedClass: string | null;
  signatureRequested: boolean;
};

const WEIGHT_LABELS: Record<string, string> = {
  "0_25_lb": "25 lb or less",
  over_25_to_50_lb: "More than 25 lb, up to 50 lb",
  over_50_lb: "More than 50 lb",
  unknown: "Unknown — Couranr review",
};

const RESTRICTED_CLASS_OPTIONS: ReadonlyArray<readonly [RestrictedClassDeclaration, string]> = [
  ["alcohol", "Alcohol"],
  ["tobacco", "Tobacco"],
  ["vaping_nicotine", "Vape or nicotine products"],
  ["cannabis_thc", "Cannabis or THC products"],
  ["firearms", "Firearms"],
  ["ammunition", "Ammunition"],
  ["prescription_medication", "Prescription medication"],
  ["controlled_substances", "Controlled substances"],
  ["fuel", "Fuel"],
  ["compressed_gas", "Compressed gas"],
  ["corrosive_hazmat", "Corrosive materials"],
  ["toxic_hazmat", "Toxic materials"],
  ["infectious_material", "Infectious material"],
  ["regulated_dangerous_goods", "Regulated dangerous goods"],
  ["fireworks", "Fireworks"],
  ["explosives", "Explosives"],
  ["illegal_goods", "Illegal goods"],
  ["stolen_goods", "Stolen goods"],
  ["cash", "Cash"],
  ["negotiable_instruments", "Checks or other negotiable instruments"],
  ["biological_specimens", "Biological specimens"],
  ["live_animals", "Live animals"],
  ["people", "People"],
];

export function HostedRequestValidationPanel({
  request,
  context,
  businessAccountId,
  canValidate,
  onChanged,
}: {
  request: DeliveryRequestView;
  context: Context | null;
  businessAccountId: string | null;
  canValidate: boolean;
  onChanged: () => void;
}) {
  const [payerType, setPayerType] = React.useState<"merchant" | "customer">(
    context?.requestedPayerType ?? (request.payerType === "merchant" ? "merchant" : "customer")
  );
  const [weightBand, setWeightBand] = React.useState(
    context?.customerWeightBand ?? request.weightBand ?? "unknown"
  );
  const [restrictedClass, setRestrictedClass] = React.useState<RestrictedClassDeclaration>(
    context?.customerRestrictedClass &&
      (context.customerRestrictedClass === "none" ||
        context.customerRestrictedClass === "unknown" ||
        RESTRICTED_CLASS_OPTIONS.some(([value]) => value === context.customerRestrictedClass))
      ? (context.customerRestrictedClass as RestrictedClassDeclaration)
      : "unknown"
  );
  const [signatureRequired, setSignatureRequired] = React.useState(
    context?.signatureRequested ?? request.signatureRequired
  );
  const [pickupDescription, setPickupDescription] = React.useState(
    context?.shipmentDescription ?? ""
  );
  const [pickupPackageCount, setPickupPackageCount] = React.useState(
    context?.customerPackageCount != null ? String(context.customerPackageCount) : ""
  );
  const [pickupOrderReference, setPickupOrderReference] = React.useState(
    context?.orderReference ?? ""
  );
  const [pickupHandlingNotes, setPickupHandlingNotes] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (
    request.source !== "hosted_request" ||
    request.requestState !== "awaiting_merchant_confirmation"
  ) {
    return null;
  }

  if (!canValidate) {
    return (
      <Card>
        <CardHeader
          title="Customer request waiting for validation"
          description="An owner, manager, or dispatcher must validate the customer-entered order before Couranr can create a payable quote."
          actions={<Badge tone="neutral">Read only</Badge>}
        />
        <Alert tone="info" title="No payment has been requested">
          Your role can view this request, but it cannot validate shipment facts or choose the delivery payer.
        </Alert>
      </Card>
    );
  }

  async function validate() {
    if (!businessAccountId || !confirmed) return;
    setBusy(true);
    setError(null);
    const result = await validateHostedRequestFromBrowser({
      id: request.id,
      businessAccountId,
      expectedVersion: request.version,
      payerType,
      weightLb: null,
      weightBand,
      restrictedClass,
      signatureRequired,
      pickupDescription,
      pickupPackageCount:
        pickupPackageCount.trim() === "" ? null : Number(pickupPackageCount),
      pickupOrderReference: pickupOrderReference.trim() || null,
      pickupHandlingNotes: pickupHandlingNotes.trim() || null,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Validate customer request"
        description="The customer started this delivery from your Couranr link. You must validate the order before Couranr can create a payable quote."
        actions={<Badge tone="warning">Payment blocked</Badge>}
      />
      <Stack gap={4}>
        <Alert tone="info" title="No customer payment has been requested">
          Couranr has not priced this delivery and cannot create a payment obligation while
          it is waiting for your validation.
        </Alert>

        {context ? (
          <Grid columns={2}>
            <div>
              <Text size="xs" muted>Order reference</Text>
              <Text>{context.orderReference ?? "Not provided"}</Text>
            </div>
            <div>
              <Text size="xs" muted>Customer requested payer</Text>
              <Text>
                {context.requestedPayerType === "merchant"
                  ? "Business"
                  : context.requestedPayerType === "customer"
                    ? "Customer"
                    : "Not provided"}
              </Text>
            </div>
            <div>
              <Text size="xs" muted>Destination selected by customer</Text>
              <Text>{context.destinationLabel ?? "Address selection unavailable"}</Text>
            </div>
            <div>
              <Text size="xs" muted>Customer weight estimate</Text>
              <Text>
                {context.customerWeightLb
                  ? `${context.customerWeightLb} lb`
                  : WEIGHT_LABELS[context.customerWeightBand ?? ""] ?? "Not provided"}
              </Text>
            </div>
          </Grid>
        ) : null}

        <Card>
          <CardHeader
            title="What the driver should expect"
            description="Confirm the physical pickup here. Couranr freezes this into the delivery so the driver does not re-enter it."
          />
          <Stack gap={3}>
            <Field
              label="Pickup description"
              required
              hint="Short physical description, for example “2 boxed flower arrangements”."
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  maxLength={1000}
                  value={pickupDescription}
                  onChange={(e) => setPickupDescription(e.target.value)}
                />
              )}
            </Field>
            <Grid columns={2}>
              <Field label="Package count" hint="Leave blank only if the count is genuinely unknown.">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={9999}
                    inputMode="numeric"
                    value={pickupPackageCount}
                    onChange={(e) => setPickupPackageCount(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Order / pickup reference">
                {(p) => (
                  <Input
                    {...p}
                    maxLength={120}
                    value={pickupOrderReference}
                    onChange={(e) => setPickupOrderReference(e.target.value)}
                  />
                )}
              </Field>
            </Grid>
            <Field label="Handling note for the driver" hint="Optional. For example: keep upright or use the rear loading door.">
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  maxLength={500}
                  value={pickupHandlingNotes}
                  onChange={(e) => setPickupHandlingNotes(e.target.value)}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Grid columns={2}>
          <Field
            label="Final delivery payer"
            required
            hint="This chooses who approves Couranr's delivery charge. It does not charge anyone yet."
          >
            {(p) => (
              <Select
                {...p}
                value={payerType}
                disabled={busy}
                onChange={(e) => setPayerType(e.target.value as "merchant" | "customer")}
              >
                <option value="customer">Customer pays Couranr</option>
                <option value="merchant">Business pays Couranr</option>
              </Select>
            )}
          </Field>

          <Field
            label="Confirmed shipment weight"
            required
            hint="Use the best band you can verify. Over 50 lb or unknown goes to Couranr review."
          >
            {(p) => (
              <Select
                {...p}
                value={weightBand}
                disabled={busy}
                onChange={(e) => setWeightBand(e.target.value)}
              >
                <option value="0_25_lb">25 lb or less</option>
                <option value="over_25_to_50_lb">More than 25 lb, up to 50 lb</option>
                <option value="over_50_lb">More than 50 lb</option>
                <option value="unknown">I cannot confirm the weight</option>
              </Select>
            )}
          </Field>
        </Grid>

        <Field
          label="Restricted-item check"
          required
          hint="Choose “none” only after you verify the order does not contain a prohibited Couranr item."
        >
          {(p) => (
            <Select
              {...p}
              value={restrictedClass}
              disabled={busy}
              onChange={(e) => setRestrictedClass(e.target.value as RestrictedClassDeclaration)}
            >
              <option value="none">Verified: none of the prohibited classes are present</option>
              <option value="unknown">Not verified — send to Couranr review</option>
              <optgroup label="A prohibited class is present">
                {RESTRICTED_CLASS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </optgroup>
            </Select>
          )}
        </Field>

        <CheckboxRow
          checked={signatureRequired}
          disabled={busy}
          onChange={(e) => setSignatureRequired(e.target.checked)}
          label="Require recipient signature"
          hint="Signature pricing is added only by Pricing V2 after validation."
        />

        <CheckboxRow
          checked={confirmed}
          disabled={busy}
          onChange={(e) => setConfirmed(e.target.checked)}
          label="I verified the pickup description, count, safety details, and payer against the order."
          hint="Couranr will verify the selected addresses, calculate the canonical Mapbox route, run shipment policy and mint the immutable quote only after this confirmation."
        />

        {error ? <ErrorState title="The request was not validated" body={error} /> : null}

        <Button
          variant="primary"
          loading={busy}
          disabled={busy || !confirmed || !businessAccountId}
          onClick={() => void validate()}
        >
          Validate request & create Couranr quote
        </Button>

        <Text size="xs" muted>
          Validating can send the request to Couranr review. It never accepts merchandise
          payment and never lets the browser choose mileage, traffic or price.
        </Text>
      </Stack>
    </Card>
  );
}
