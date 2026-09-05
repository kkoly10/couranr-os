"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Cluster, Stack, Text } from "@/components/couranr/primitives";
import { CheckboxRow, Field, Input, Select, Textarea } from "@/components/couranr/forms";

type Suggestion = { placeId: string; text: string };
type WeightBand = "0_25_lb" | "over_25_to_50_lb" | "over_50_lb" | "unknown";
type RequestView = {
  submitted: boolean;
  requestState: string | null;
  quoteStatus: string | null;
  merchantValidated: boolean;
  paymentPending: boolean;
  terminal: boolean;
  trackingToken?: string;
};

const HEADER = "x-couranr-hosted-request";

function storageKey(slug: string) {
  return `couranr-hosted-request:${slug}`;
}

function statusCopy(view: RequestView | null, merchantName: string) {
  if (!view?.submitted || view.requestState === "awaiting_merchant_confirmation") {
    return {
      title: `Waiting for ${merchantName} to validate`,
      body: "Your request was sent. No delivery payment is due until the business validates the order and Couranr creates a delivery quote.",
      tone: "info" as const,
    };
  }
  if (view.paymentPending) {
    return {
      title: "Validated — payment is the next step",
      body: "The business validated the delivery. If you are the payer, they will send you a secure Couranr payment link. Couranr does not charge for the merchandise.",
      tone: "success" as const,
    };
  }
  if (view.requestState === "confirmed") {
    return {
      title: "Delivery confirmed",
      body: "Payment and review are complete. The business will mark the order ready before Couranr dispatches it.",
      tone: "success" as const,
    };
  }
  if (view.terminal) {
    return {
      title: "This request is no longer active",
      body: "Contact the business if you need to submit a new delivery request.",
      tone: "warning" as const,
    };
  }
  return {
    title: "Couranr is reviewing the delivery",
    body: "The business validated the order. Couranr is reviewing the delivery details before payment or fulfillment continues.",
    tone: "info" as const,
  };
}

export function HostedRequestFlow({
  merchantName,
  merchantSlug,
}: {
  merchantName: string;
  merchantSlug: string;
}) {
  const [token, setToken] = React.useState<string | null>(null);
  const [requestView, setRequestView] = React.useState<RequestView | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const [orderReference, setOrderReference] = React.useState("");
  const [destinationQuery, setDestinationQuery] = React.useState("");
  const [destinationPlaceId, setDestinationPlaceId] = React.useState("");
  const [destinationLabel, setDestinationLabel] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [searching, setSearching] = React.useState(false);

  const [recipientName, setRecipientName] = React.useState("");
  const [recipientPhone, setRecipientPhone] = React.useState("");
  const [recipientEmail, setRecipientEmail] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [weightBand, setWeightBand] = React.useState<WeightBand>("0_25_lb");
  const [restrictedClass, setRestrictedClass] = React.useState<"none" | "unknown">("none");
  const [signatureRequired, setSignatureRequired] = React.useState(false);
  const [requestedPayer, setRequestedPayer] = React.useState<"merchant" | "customer">("customer");

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const searchSeq = React.useRef(0);

  const apiBase = `/api/couranr/hosted/${encodeURIComponent(merchantSlug)}`;

  const ensureToken = React.useCallback(async (): Promise<string | null> => {
    if (token) return token;
    const existing = window.sessionStorage.getItem(storageKey(merchantSlug));
    if (existing) {
      setToken(existing);
      return existing;
    }
    const response = await fetch(`${apiBase}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.token) {
      setError(payload?.error ?? "This request link is not available right now.");
      return null;
    }
    window.sessionStorage.setItem(storageKey(merchantSlug), payload.token);
    setToken(payload.token);
    return payload.token;
  }, [apiBase, merchantSlug, token]);

  const readStatus = React.useCallback(async (rawToken: string) => {
    const response = await fetch(`${apiBase}/request`, {
      headers: { [HEADER]: rawToken },
      cache: "no-store",
    });
    if (response.status === 404) {
      window.sessionStorage.removeItem(storageKey(merchantSlug));
      setToken(null);
      return;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) return;
    setRequestView(payload as RequestView);
    if (payload.submitted) setSubmitted(true);
  }, [apiBase, merchantSlug]);

  React.useEffect(() => {
    const existing = window.sessionStorage.getItem(storageKey(merchantSlug));
    if (!existing) return;
    setToken(existing);
    void readStatus(existing);
  }, [merchantSlug, readStatus]);

  React.useEffect(() => {
    if (submitted || destinationPlaceId || destinationQuery.trim().length < 3) {
      if (!destinationPlaceId) setSuggestions([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        const rawToken = await ensureToken();
        if (!rawToken || seq !== searchSeq.current) return;
        setSearching(true);
        const response = await fetch(
          `${apiBase}/places?query=${encodeURIComponent(destinationQuery.trim())}`,
          { headers: { [HEADER]: rawToken }, cache: "no-store" }
        );
        const payload = await response.json().catch(() => null);
        if (seq !== searchSeq.current) return;
        setSearching(false);
        if (!response.ok) {
          setSuggestions([]);
          setError(payload?.error ?? "Address lookup is unavailable.");
          return;
        }
        setError(null);
        setSuggestions(Array.isArray(payload?.suggestions) ? payload.suggestions : []);
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [apiBase, destinationPlaceId, destinationQuery, ensureToken, submitted]);

  function editDestination(value: string) {
    searchSeq.current += 1;
    setDestinationQuery(value);
    setDestinationPlaceId("");
    setDestinationLabel("");
    setSuggestions([]);
    setError(null);
  }

  function chooseDestination(suggestion: Suggestion) {
    searchSeq.current += 1;
    setDestinationPlaceId(suggestion.placeId);
    setDestinationLabel(suggestion.text);
    setDestinationQuery(suggestion.text);
    setSuggestions([]);
    setSearching(false);
    setError(null);
  }

  async function submit() {
    setError(null);
    if (!destinationPlaceId) {
      setError("Choose a destination from the address suggestions.");
      return;
    }
    if (!recipientName.trim() || (!recipientPhone.trim() && !recipientEmail.trim())) {
      setError("Add the recipient name and either a phone number or email.");
      return;
    }
    if (!description.trim()) {
      setError("Tell the business what needs to be delivered.");
      return;
    }

    setBusy(true);
    const rawToken = await ensureToken();
    if (!rawToken) {
      setBusy(false);
      return;
    }
    const response = await fetch(`${apiBase}/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HEADER]: rawToken,
      },
      body: JSON.stringify({
        orderReference: orderReference.trim() || null,
        requestedPayer,
        destinationPlaceId,
        destinationLabel,
        recipient: {
          name: recipientName.trim(),
          phone: recipientPhone.trim() || null,
          email: recipientEmail.trim() || null,
        },
        shipment: {
          description: description.trim(),
          weightBand,
          restrictedClass,
          signatureRequired,
        },
      }),
    });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setError(payload?.error ?? "Your request could not be sent.");
      return;
    }
    setSubmitted(true);
    await readStatus(rawToken);
  }

  if (submitted) {
    const copy = statusCopy(requestView, merchantName);
    return (
      <div className="cr-send-panel">
        <Card>
          <CardHeader
            title="Delivery request received"
            description={`Requested through ${merchantName}`}
            actions={<Badge tone="info">Merchant validation</Badge>}
          />
          <Stack gap={4}>
            <Alert tone={copy.tone} title={copy.title}>
              {copy.body}
            </Alert>
            <Text size="sm" muted>
              Couranr is handling delivery only. Any merchandise purchase, refund or order
              change remains between you and {merchantName}.
            </Text>
            {requestView?.trackingToken ? (
              <Button
                variant="primary"
                type="button"
                onClick={() => {
                  window.location.assign(
                    `/track/${encodeURIComponent(requestView.trackingToken ?? "")}`
                  );
                }}
              >
                Track delivery
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                const raw = token ?? window.sessionStorage.getItem(storageKey(merchantSlug));
                if (raw) void readStatus(raw);
              }}
            >
              Refresh status
            </Button>
          </Stack>
        </Card>
      </div>
    );
  }

  return (
    <div className="cr-send-panel">
      <Stack gap={6}>
        <div>
          <Text size="sm" muted>Delivery request for</Text>
          <h1>Have {merchantName} send your order with Couranr</h1>
          <Text muted>
            Tell {merchantName} where the order is going and what Couranr would carry.
            The business validates the request before any delivery payment can begin.
          </Text>
        </div>

        {error ? <Alert tone="danger" title="Check these details">{error}</Alert> : null}

        <Card>
          <CardHeader
            title="Order and destination"
            description="This is a delivery request, not merchandise checkout."
          />
          <Stack gap={4}>
            <Field label="Order or reference number" hint="Use the number the business gave you, if you have one.">
              {(p) => <Input {...p} value={orderReference} onChange={(e) => setOrderReference(e.target.value)} />}
            </Field>

            <Field label="Delivery destination" required hint="Choose a street address from the suggestions.">
              {(p) => (
                <div className="cr-place-search">
                  <Input
                    {...p}
                    type="text"
                    inputMode="search"
                    autoComplete="street-address"
                    value={destinationQuery}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={suggestions.length > 0}
                    onChange={(e) => editDestination(e.target.value)}
                    placeholder="Start typing a street address"
                  />
                  {searching ? <p className="cr-send-field__note">Searching addresses…</p> : null}
                  {suggestions.length > 0 ? (
                    <ul className="cr-send-suggestions" role="listbox">
                      {suggestions.map((suggestion) => (
                        <li key={suggestion.placeId}>
                          <button
                            type="button"
                            className="cr-send-suggestion"
                            role="option"
                            aria-selected={destinationPlaceId === suggestion.placeId}
                            onClick={() => chooseDestination(suggestion)}
                          >
                            <span className="cr-send-suggestion__label">{suggestion.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </Field>
          </Stack>
        </Card>

        <Card>
          <CardHeader title="Recipient" description="Who should receive the delivery?" />
          <Stack gap={4}>
            <Field label="Recipient name" required>
              {(p) => <Input {...p} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />}
            </Field>
            <Cluster gap={3}>
              <Field label="Phone" hint="Phone or email is required.">
                {(p) => <Input {...p} type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />}
              </Field>
              <Field label="Email" hint="Phone or email is required.">
                {(p) => <Input {...p} type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />}
              </Field>
            </Cluster>
          </Stack>
        </Card>

        <Card>
          <CardHeader
            title="What is being delivered?"
            description="The business will verify these details before Couranr prices the delivery."
          />
          <Stack gap={4}>
            <Field label="Describe the order" required>
              {(p) => (
                <Textarea
                  {...p}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Example: one boxed lamp and two small bags"
                />
              )}
            </Field>

            <Field label="Approximate total weight" required>
              {(p) => (
                <Select {...p} value={weightBand} onChange={(e) => setWeightBand(e.target.value as WeightBand)}>
                  <option value="0_25_lb">25 lb or less</option>
                  <option value="over_25_to_50_lb">More than 25 lb, up to 50 lb</option>
                  <option value="over_50_lb">More than 50 lb</option>
                  <option value="unknown">I am not sure</option>
                </Select>
              )}
            </Field>

            <Field
              label="Restricted items"
              required
              hint="If you are unsure whether Couranr can carry something in the order, choose “I’m not sure.”"
            >
              {(p) => (
                <Select
                  {...p}
                  value={restrictedClass}
                  onChange={(e) => setRestrictedClass(e.target.value as "none" | "unknown")}
                >
                  <option value="none">None of the restricted item types are in this order</option>
                  <option value="unknown">I’m not sure — have the business review it</option>
                </Select>
              )}
            </Field>

            <CheckboxRow
              checked={signatureRequired}
              onChange={(e) => setSignatureRequired(e.target.checked)}
              label="Require a signature at delivery"
              hint="Couranr charges the signature fee only after the business validates the request."
            />
          </Stack>
        </Card>

        <Card>
          <CardHeader title="Who should pay Couranr for delivery?" />
          <Stack gap={3}>
            <Field label="Requested payer" required hint="The business confirms the final payer when it validates your request.">
              {(p) => (
                <Select {...p} value={requestedPayer} onChange={(e) => setRequestedPayer(e.target.value as "merchant" | "customer")}>
                  <option value="customer">I will pay for delivery</option>
                  <option value="merchant">Ask the business to pay for delivery</option>
                </Select>
              )}
            </Field>
            <Alert tone="info" title="No payment yet">
              Couranr will not create a delivery charge or payment link until {merchantName}
              validates the request and Couranr creates the canonical delivery quote.
            </Alert>
          </Stack>
        </Card>

        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void submit()}>
          Send request to {merchantName}
        </Button>

        <Text size="xs" muted>
          Couranr handles delivery only. Product availability, merchandise price, substitutions and
          merchandise refunds stay with {merchantName}.
        </Text>
      </Stack>
    </div>
  );
}
