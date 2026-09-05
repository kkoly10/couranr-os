"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Grid,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { Field, Input, Select } from "@/components/couranr/forms";
import {
  declineHostedRequestFromBrowser,
  isApiFailure,
  searchBusinessPlaces,
  validateHostedRequestFromBrowser,
  withReference,
  type BusinessPlaceSuggestion,
  type HostedIntakeView,
} from "./client";
import type { DeliveryRequestView } from "@/lib/couranr/requests/view";

const WEIGHT_BANDS = [
  ["0_25_lb", "25 lb or less"],
  ["over_25_to_50_lb", "Over 25 lb to 50 lb"],
  ["over_50_lb", "Over 50 lb"],
  ["unknown", "Unknown — send to Couranr review"],
] as const;

const RESTRICTED = [
  ["none", "None of Couranr's prohibited classes"],
  ["unknown", "Unknown — send to Couranr review"],
  ["alcohol", "Alcohol"],
  ["tobacco", "Tobacco"],
  ["vaping_nicotine", "Vape or nicotine products"],
  ["cannabis_thc", "Cannabis or THC"],
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
  ["negotiable_instruments", "Checks or negotiable instruments"],
  ["biological_specimens", "Biological specimens"],
  ["live_animals", "Live animals"],
  ["people", "People"],
] as const;

const DECLINES = [
  ["order_not_found", "We cannot match this to an order"],
  ["details_do_not_match", "The delivery details do not match the order"],
  ["merchant_cannot_fulfill", "We cannot prepare this order for delivery"],
] as const;

export function HostedRequestValidationPanel({
  request,
  hosted,
  businessAccountId,
  onChanged,
}: {
  request: DeliveryRequestView;
  hosted: HostedIntakeView;
  businessAccountId: string;
  onChanged: () => void;
}) {
  const [pickupQuery, setPickupQuery] = React.useState("");
  const [pickup, setPickup] = React.useState<BusinessPlaceSuggestion | null>(null);
  const [suggestions, setSuggestions] = React.useState<BusinessPlaceSuggestion[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [destinationConfirmed, setDestinationConfirmed] = React.useState(false);

  const [weightMode, setWeightMode] = React.useState<"exact" | "band">(
    request.weightLb !== null ? "exact" : "band"
  );
  const [weightLb, setWeightLb] = React.useState(
    request.weightLb === null ? "" : String(request.weightLb)
  );
  const [weightBand, setWeightBand] = React.useState(request.weightBand ?? "unknown");
  const [restrictedClass, setRestrictedClass] = React.useState(
    request.restrictedClass ?? "unknown"
  );
  const [signatureRequired, setSignatureRequired] = React.useState(
    request.signatureRequired
  );
  const [payerType, setPayerType] = React.useState<"merchant" | "customer">(
    hosted.requestedPayerType
  );

  const [declineReason, setDeclineReason] =
    React.useState<(typeof DECLINES)[number][0]>("details_do_not_match");
  const [busy, setBusy] = React.useState<"validate" | "decline" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function searchPickup() {
    const q = pickupQuery.trim();
    if (q.length < 3) {
      setError("Enter at least 3 characters of the pickup address.");
      return;
    }
    setSearching(true);
    setError(null);
    setSuggestions([]);
    const result = await searchBusinessPlaces({ businessAccountId, query: q });
    setSearching(false);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    setSuggestions(result.value.suggestions ?? []);
    if ((result.value.suggestions ?? []).length === 0) {
      setError("No matching pickup addresses were found.");
    }
  }

  function choosePickup(value: BusinessPlaceSuggestion) {
    setPickup(value);
    setPickupQuery(value.text);
    setSuggestions([]);
    setError(null);
  }

  function editPickup(value: string) {
    setPickupQuery(value);
    setPickup(null);
    setSuggestions([]);
  }

  async function validate() {
    if (!pickup) {
      setError("Search for and select the pickup address.");
      return;
    }
    if (!destinationConfirmed) {
      setError("Confirm that the customer's destination matches this order.");
      return;
    }

    const exact =
      weightMode === "exact" && weightLb.trim() !== "" ? Number(weightLb) : null;
    if (weightMode === "exact" && (!Number.isFinite(exact) || Number(exact) <= 0)) {
      setError("Enter a valid package weight.");
      return;
    }

    setBusy("validate");
    setError(null);
    const result = await validateHostedRequestFromBrowser({
      id: request.id,
      businessAccountId,
      expectedVersion: request.version,
      validation: {
        pickupPlaceId: pickup.placeId,
        payerType,
        weightLb: exact,
        weightBand: weightMode === "band" ? weightBand : null,
        restrictedClass,
        signatureRequired,
      },
    });
    setBusy(null);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    onChanged();
  }

  async function decline() {
    setBusy("decline");
    setError(null);
    const result = await declineHostedRequestFromBrowser({
      id: request.id,
      businessAccountId,
      expectedVersion: request.version,
      reason: declineReason,
    });
    setBusy(null);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    onChanged();
  }

  return (
    <Stack gap={5}>
      <Alert tone="warning" title="Customer request — validate before any payment">
        The customer created this intake from your Couranr link. No quote or
        payment exists yet. Check the order and shipment, then Couranr will
        resolve the addresses, calculate the canonical route and create the
        first delivery quote.
      </Alert>

      <Card>
        <CardHeader
          title="Customer request"
          actions={<Badge tone="warning">Needs business validation</Badge>}
        />
        <Grid columns={2}>
          <div>
            <Text size="xs" muted>Order reference</Text>
            <Text strong>{hosted.orderReference}</Text>
          </div>
          <div>
            <Text size="xs" muted>Customer requested payer</Text>
            <Text strong>
              {hosted.requestedPayerType === "merchant" ? "Business" : "Customer"}
            </Text>
          </div>
        </Grid>
        <Stack gap={2}>
          <div>
            <Text size="xs" muted>Customer described</Text>
            <Text>{hosted.shipmentDescription}</Text>
          </div>
          <div>
            <Text size="xs" muted>Delivery destination</Text>
            <Text strong>{hosted.dropoffDisplayText}</Text>
          </div>
        </Stack>
      </Card>

      <Card>
        <CardHeader
          title="Validate delivery facts"
          description="These are the facts Couranr will use to create the delivery-only quote."
        />
        <Stack gap={4}>
          <Field label="Pickup address" hint="Search once, then select the exact business location." required>
            {(p) => (
              <Input
                {...p}
                value={pickupQuery}
                autoComplete="street-address"
                onChange={(e) => editPickup(e.target.value)}
                placeholder="Start with the street address"
              />
            )}
          </Field>
          <Cluster gap={2}>
            <Button type="button" loading={searching} onClick={() => void searchPickup()}>
              Search pickup
            </Button>
            {pickup ? <Badge tone="success">Pickup selected</Badge> : null}
          </Cluster>
          {suggestions.length > 0 ? (
            <div className="cr-send-suggestions" role="listbox" aria-label="Pickup suggestions">
              {suggestions.map((s) => (
                <button
                  key={s.placeId}
                  type="button"
                  className="cr-send-suggestion"
                  onClick={() => choosePickup(s)}
                >
                  <span className="cr-send-suggestion__label">{s.text}</span>
                </button>
              ))}
            </div>
          ) : null}

          <label className="cr-checkbox-row">
            <input
              type="checkbox"
              checked={destinationConfirmed}
              onChange={(e) => setDestinationConfirmed(e.target.checked)}
            />
            <span>
              I checked the order and confirm the destination above is the
              correct delivery address.
            </span>
          </label>

          <Grid columns={2}>
            <Field label="Weight knowledge" required>
              {(p) => (
                <Select
                  {...p}
                  value={weightMode}
                  onChange={(e) => setWeightMode(e.target.value as "exact" | "band")}
                >
                  <option value="band">Weight range</option>
                  <option value="exact">Exact weight</option>
                </Select>
              )}
            </Field>

            {weightMode === "exact" ? (
              <Field label="Exact weight (lb)" required>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={weightLb}
                    onChange={(e) => setWeightLb(e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <Field label="Weight range" required>
                {(p) => (
                  <Select
                    {...p}
                    value={weightBand}
                    onChange={(e) => setWeightBand(e.target.value)}
                  >
                    {WEIGHT_BANDS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </Grid>

          <Field
            label="Shipment declaration"
            hint="None means you have checked that no prohibited class is present."
            required
          >
            {(p) => (
              <Select
                {...p}
                value={restrictedClass}
                onChange={(e) => setRestrictedClass(e.target.value)}
              >
                {RESTRICTED.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            )}
          </Field>

          <Grid columns={2}>
            <Field label="Delivery payer" required>
              {(p) => (
                <Select
                  {...p}
                  value={payerType}
                  onChange={(e) => setPayerType(e.target.value as "merchant" | "customer")}
                >
                  <option value="customer">Customer pays Couranr</option>
                  <option value="merchant">Business pays Couranr</option>
                </Select>
              )}
            </Field>
            <label className="cr-checkbox-row">
              <input
                type="checkbox"
                checked={signatureRequired}
                onChange={(e) => setSignatureRequired(e.target.checked)}
              />
              <span>Require recipient signature (+$3)</span>
            </label>
          </Grid>

          {error ? <Alert tone="danger" title="This request needs attention">{error}</Alert> : null}

          <Button
            variant="primary"
            type="button"
            loading={busy === "validate"}
            disabled={busy !== null}
            onClick={() => void validate()}
          >
            Validate request and calculate Couranr quote
          </Button>
          <Text size="xs" muted>
            This action does not charge anyone. If the customer is the payer,
            the secure Couranr payment link becomes available only after this
            validation succeeds.
          </Text>
        </Stack>
      </Card>

      <Card>
        <CardHeader
          title="Cannot validate this order?"
          description="Declining ends this delivery request before a quote or payment exists."
        />
        <Stack gap={3}>
          <Field label="Reason" required>
            {(p) => (
              <Select
                {...p}
                value={declineReason}
                onChange={(e) =>
                  setDeclineReason(e.target.value as (typeof DECLINES)[number][0])
                }
              >
                {DECLINES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            type="button"
            variant="secondary"
            loading={busy === "decline"}
            disabled={busy !== null}
            onClick={() => void decline()}
          >
            Decline request
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}
