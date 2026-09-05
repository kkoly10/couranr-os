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
import { Field, Input, Select, Textarea } from "@/components/couranr/forms";
import type { PublicHostedMerchant, HostedGuestStatus } from "@/lib/couranr/hosted/commands";
import { GUEST_HEADER } from "@/lib/couranr/sameday/liveAdapters";

type Suggestion = { id: string; label: string; detail?: string };
type Phase = "form" | "submitted";

const WEIGHT_BANDS = [
  ["0_25_lb", "25 lb or less"],
  ["over_25_to_50_lb", "Over 25 lb to 50 lb"],
  ["over_50_lb", "Over 50 lb"],
  ["unknown", "I do not know"],
] as const;

const RESTRICTED = [
  ["none", "None of these"],
  ["unknown", "I am not sure"],
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

function storageKey(slug: string) {
  return `couranr-hosted-guest:${slug.toLowerCase()}`;
}

function safeRead(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage is a convenience, not authority.
  }
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function declineCopy(reason: string | null): string {
  switch (reason) {
    case "order_not_found":
      return "The business could not match this request to an order.";
    case "details_do_not_match":
      return "The business could not confirm the delivery details.";
    case "merchant_cannot_fulfill":
      return "The business cannot prepare this order for Couranr delivery.";
    default:
      return "The business could not validate this request.";
  }
}

export function HostedRequestFlow({ merchant }: { merchant: PublicHostedMerchant }) {
  const key = React.useMemo(() => storageKey(merchant.slug), [merchant.slug]);
  const [token, setToken] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<Phase>("form");
  const [status, setStatus] = React.useState<HostedGuestStatus | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [orderReference, setOrderReference] = React.useState("");
  const [contact, setContact] = React.useState({ name: "", phone: "", email: "" });
  const [destinationQuery, setDestinationQuery] = React.useState("");
  const [destinationPlaceId, setDestinationPlaceId] = React.useState<string | null>(null);
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [weightMode, setWeightMode] = React.useState<"exact" | "band">("band");
  const [weightLb, setWeightLb] = React.useState("");
  const [weightBand, setWeightBand] = React.useState("0_25_lb");
  const [restrictedClass, setRestrictedClass] = React.useState("unknown");
  const [signatureRequired, setSignatureRequired] = React.useState(false);
  const [payerType, setPayerType] = React.useState<"merchant" | "customer">(
    merchant.payerDefault
  );

  const ensureSession = React.useCallback(async (): Promise<string | null> => {
    if (token) return token;
    const stored = safeRead(key);
    if (stored) {
      setToken(stored);
      return stored;
    }
    const res = await fetch("/api/couranr/consumer/session", {
      method: "POST",
      cache: "no-store",
    });
    const body = await readJson(res);
    const raw = body?.guestSession?.token;
    if (!res.ok || typeof raw !== "string" || raw.length < 20) {
      setError(body?.error ?? "Couranr could not start this request.");
      return null;
    }
    setToken(raw);
    safeWrite(key, raw);
    return raw;
  }, [key, token]);

  const checkStatus = React.useCallback(
    async (rawToken?: string | null) => {
      const credential = rawToken ?? token ?? safeRead(key);
      if (!credential) return;
      setChecking(true);
      const res = await fetch(
        `/api/couranr/hosted-request/${encodeURIComponent(merchant.slug)}/status`,
        {
          method: "GET",
          cache: "no-store",
          headers: { [GUEST_HEADER]: credential },
        }
      );
      const body = await readJson(res);
      setChecking(false);
      if (res.status === 404) {
        safeWrite(key, null);
        setToken(null);
        return;
      }
      if (!res.ok || !body?.request) {
        setError(body?.error ?? "Couranr could not check this request.");
        return;
      }
      setToken(credential);
      setStatus(body.request);
      setPhase("submitted");
      setError(null);
    },
    [key, merchant.slug, token]
  );

  React.useEffect(() => {
    const stored = safeRead(key);
    if (!stored) return;
    setToken(stored);
    void checkStatus(stored);
    // Resume once per merchant slug. Status can be refreshed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function searchAddress() {
    const q = destinationQuery.trim();
    if (q.length < 3) {
      setError("Enter at least 3 characters of the delivery address.");
      return;
    }
    setError(null);
    setSearching(true);
    setSuggestions([]);
    const credential = await ensureSession();
    if (!credential) {
      setSearching(false);
      return;
    }
    const res = await fetch(
      `/api/couranr/consumer/places?query=${encodeURIComponent(q)}`,
      {
        cache: "no-store",
        headers: { [GUEST_HEADER]: credential },
      }
    );
    const body = await readJson(res);
    setSearching(false);
    if (!res.ok) {
      setError(body?.error ?? "Address search is unavailable.");
      return;
    }
    const found = Array.isArray(body?.suggestions) ? body.suggestions : [];
    setSuggestions(found);
    if (found.length === 0) setError("No matching street addresses were found.");
  }

  function chooseAddress(s: Suggestion) {
    setDestinationPlaceId(s.id);
    setDestinationQuery(s.detail ? `${s.label}, ${s.detail}` : s.label);
    setSuggestions([]);
    setError(null);
  }

  function editAddress(value: string) {
    setDestinationQuery(value);
    setDestinationPlaceId(null);
    setSuggestions([]);
  }

  async function submit() {
    setError(null);

    const exact =
      weightMode === "exact" && weightLb.trim() !== "" ? Number(weightLb) : null;
    const band = weightMode === "band" ? weightBand : null;
    if (!orderReference.trim()) {
      setError("Enter the order or receipt reference the business can recognize.");
      return;
    }
    if (!destinationPlaceId) {
      setError("Search for and select the delivery address.");
      return;
    }
    if (!contact.phone.trim() && !contact.email.trim()) {
      setError("Enter a phone number or email so this request can be reached.");
      return;
    }
    if (!description.trim()) {
      setError("Describe what the business will hand to Couranr.");
      return;
    }
    if (weightMode === "exact" && (!Number.isFinite(exact) || Number(exact) <= 0)) {
      setError("Enter a valid package weight.");
      return;
    }

    const credential = await ensureSession();
    if (!credential) return;

    setBusy(true);
    const res = await fetch(
      `/api/couranr/hosted-request/${encodeURIComponent(merchant.slug)}/submit`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          [GUEST_HEADER]: credential,
        },
        body: JSON.stringify({
          orderReference,
          contact,
          dropoffPlaceId: destinationPlaceId,
          dropoffDisplayText: destinationQuery,
          shipmentDescription: description,
          weightLb: exact,
          weightBand: band,
          restrictedClass,
          signatureRequired,
          payerType,
        }),
      }
    );
    const body = await readJson(res);
    setBusy(false);
    if (!res.ok) {
      setError(body?.error ?? "This request could not be submitted.");
      return;
    }
    setPhase("submitted");
    await checkStatus(credential);
  }

  if (phase === "submitted") {
    const waiting = status?.intakeState === "awaiting_merchant_confirmation";
    const validated = status?.intakeState === "validated";
    const declined = status?.intakeState === "declined";

    return (
      <main className="cr-send-shell">
        <Stack gap={5}>
          <div className="cr-send-intro">
            <Badge tone={declined ? "danger" : validated ? "success" : "warning"}>
              {declined ? "Not validated" : validated ? "Validated by business" : "Business validation"}
            </Badge>
            <h1>{merchant.name} delivery request</h1>
            <p>
              Couranr handles the delivery. {merchant.name} remains responsible
              for confirming the order and what will be handed to the driver.
            </p>
          </div>

          {waiting ? (
            <Alert tone="info" title={`Waiting for ${merchant.name} to validate your order`}>
              Couranr will not ask you to pay before the business validates this
              request. You can come back to this page and check the status.
            </Alert>
          ) : null}

          {validated && status?.payerType === "customer" ? (
            <Alert tone="success" title="The business validated your delivery request">
              The delivery quote is now created. {merchant.name} can send you a
              secure Couranr payment link if customer payment is required.
              Couranr does not automatically text or email that link in this MVP.
            </Alert>
          ) : null}

          {validated && status?.payerType === "merchant" ? (
            <Alert tone="success" title="The business validated your delivery request">
              {merchant.name} selected business-paid delivery. There is no
              customer payment step for you.
            </Alert>
          ) : null}

          {declined ? (
            <Alert tone="danger" title="The business could not validate this request">
              {declineCopy(status?.declineReason ?? null)} Contact the business
              about the merchandise/order itself.
            </Alert>
          ) : null}

          {error ? <Alert tone="danger" title="Status could not be refreshed">{error}</Alert> : null}

          <Cluster gap={3}>
            <Button
              variant="primary"
              type="button"
              loading={checking}
              onClick={() => void checkStatus()}
            >
              Check status
            </Button>
          </Cluster>

          <Text size="xs" muted>
            This Couranr request covers delivery service only. It is not a
            product checkout and does not collect the price of the merchandise.
          </Text>
        </Stack>
      </main>
    );
  }

  return (
    <main className="cr-send-shell">
      <Stack gap={6}>
        <div className="cr-send-intro">
          <Badge tone="info">Delivery request</Badge>
          <h1>Request delivery from {merchant.name}</h1>
          <p>
            Tell {merchant.name} where the order should go and what Couranr
            would pick up. The business validates the request before any
            delivery payment can begin.
          </p>
        </div>

        <Alert tone="info" title="This is not the store checkout">
          Pay the business for merchandise the way you normally do. This form
          requests Couranr delivery only.
        </Alert>

        <Card>
          <CardHeader
            title="Order"
            description={`Give ${merchant.name} enough information to recognize the order.`}
          />
          <Stack gap={4}>
            <Field label="Order or receipt reference" required>
              {(p) => (
                <Input
                  {...p}
                  value={orderReference}
                  maxLength={120}
                  onChange={(e) => setOrderReference(e.target.value)}
                  placeholder="Example: order 1042 or receipt name"
                />
              )}
            </Field>

            <Grid columns={2}>
              <Field label="Your name">
                {(p) => (
                  <Input
                    {...p}
                    value={contact.name}
                    maxLength={160}
                    autoComplete="name"
                    onChange={(e) => setContact({ ...contact, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Phone">
                {(p) => (
                  <Input
                    {...p}
                    value={contact.phone}
                    maxLength={40}
                    autoComplete="tel"
                    inputMode="tel"
                    onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                  />
                )}
              </Field>
            </Grid>
            <Field label="Email" hint="Phone or email is required.">
              {(p) => (
                <Input
                  {...p}
                  value={contact.email}
                  maxLength={254}
                  autoComplete="email"
                  inputMode="email"
                  onChange={(e) => setContact({ ...contact, email: e.target.value })}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Card>
          <CardHeader
            title="Delivery address"
            description="Search and select the exact street address."
          />
          <Stack gap={3}>
            <Field label="Destination" required>
              {(p) => (
                <Input
                  {...p}
                  value={destinationQuery}
                  autoComplete="street-address"
                  onChange={(e) => editAddress(e.target.value)}
                  placeholder="Start with the street address"
                />
              )}
            </Field>
            <Cluster gap={2}>
              <Button type="button" loading={searching} onClick={() => void searchAddress()}>
                Search address
              </Button>
              {destinationPlaceId ? <Badge tone="success">Address selected</Badge> : null}
            </Cluster>
            {suggestions.length > 0 ? (
              <div className="cr-send-suggestions" role="listbox" aria-label="Address suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="cr-send-suggestion"
                    onClick={() => chooseAddress(s)}
                  >
                    <span className="cr-send-suggestion__label">{s.label}</span>
                    {s.detail ? <span>{s.detail}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </Stack>
        </Card>

        <Card>
          <CardHeader
            title="What will Couranr pick up?"
            description="The business will check these details before Couranr creates the delivery quote."
          />
          <Stack gap={4}>
            <Field label="Package or order description" required>
              {(p) => (
                <Textarea
                  {...p}
                  value={description}
                  maxLength={2000}
                  rows={4}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Example: one boxed lamp and one small bag"
                />
              )}
            </Field>

            <Field label="Weight" required>
              {(p) => (
                <Select
                  {...p}
                  value={weightMode}
                  onChange={(e) => setWeightMode(e.target.value as "exact" | "band")}
                >
                  <option value="band">Choose a weight range</option>
                  <option value="exact">I know the exact weight</option>
                </Select>
              )}
            </Field>

            {weightMode === "exact" ? (
              <Field label="Exact weight (lb)" required>
                {(p) => (
                  <Input
                    {...p}
                    value={weightLb}
                    type="number"
                    min="0.1"
                    step="0.1"
                    inputMode="decimal"
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

            <Field
              label="Restricted or regulated items"
              hint="Choose None only if you can confirm none of these classes are present."
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

            <label className="cr-checkbox-row">
              <input
                type="checkbox"
                checked={signatureRequired}
                onChange={(e) => setSignatureRequired(e.target.checked)}
              />
              <span>Require recipient signature (+$3 if the request is validated and priced)</span>
            </label>
          </Stack>
        </Card>

        <Card>
          <CardHeader
            title="Who should pay Couranr for delivery?"
            description="This is a preference. The business confirms the final payer when it validates the request."
          />
          <Field label="Delivery payer" required>
            {(p) => (
              <Select
                {...p}
                value={payerType}
                onChange={(e) => setPayerType(e.target.value as "merchant" | "customer")}
              >
                <option value="customer">I will pay Couranr for delivery</option>
                <option value="merchant">{merchant.name} will pay Couranr for delivery</option>
              </Select>
            )}
          </Field>
        </Card>

        {error ? <Alert tone="danger" title="Check this request">{error}</Alert> : null}

        <Stack gap={3}>
          <Button variant="primary" type="button" loading={busy} onClick={() => void submit()}>
            Send request to {merchant.name}
          </Button>
          <Text size="xs" muted>
            Sending this form does not authorize a charge. {merchant.name} must
            validate the order first. If customer-paid delivery is approved,
            the business can create a separate secure Couranr payment link.
          </Text>
        </Stack>
      </Stack>
    </main>
  );
}
