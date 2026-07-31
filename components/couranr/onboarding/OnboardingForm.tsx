"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Cluster,
  Grid,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { CheckboxRow, Field, Input, Select, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import { BUSINESS_CATEGORIES } from "@/lib/couranr/onboarding/workspace";
import {
  isApiFailure,
  newIdempotencyKey,
  withReference,
  type ApiFailure,
} from "@/components/couranr/requests/client";
import { createWorkspace, fetchMyBusinessAccounts } from "./client";

/**
 * MER-002 — merchant onboarding.
 *
 * Collects only what a merchant needs to send their first delivery: name,
 * category, pickup address, phone, payer default and policy acceptance.
 * Stripe setup, logos and team invitations are activation steps, not signup —
 * putting them here is how a merchant never finishes onboarding.
 */

const ERROR_COPY: Record<string, string> = {
  name_required: "Enter your business name.",
  name_too_long: "That name is too long.",
  unknown_business_category: "Choose a category.",
  invalid_pickup_address: "Enter a street address, city, state and ZIP.",
  contact_phone_required: "Enter a contact phone number.",
  contact_phone_invalid: "Enter a phone number with 10 to 15 digits.",
  unknown_payer_default: "Choose who pays by default.",
  policies_not_accepted: "You need to accept the policies to continue.",
};

const EMPTY_ADDRESS = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  instructions: "",
};

export function OnboardingForm() {
  const router = useRouter();

  const [existing, setExisting] = React.useState<string[] | null>(null);
  const [name, setName] = React.useState("");
  const [businessCategory, setBusinessCategory] = React.useState("");
  const [pickup, setPickup] = React.useState({ ...EMPTY_ADDRESS });
  const [contactPhone, setContactPhone] = React.useState("");
  const [payerDefault, setPayerDefault] = React.useState("merchant");
  const [policiesAccepted, setPoliciesAccepted] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // One key per form instance: a double-click or a retry after a dropped
  // response reaches the same idempotent create rather than making a second
  // workspace.
  const idempotencyKey = React.useRef<string>("");
  if (idempotencyKey.current === "") idempotencyKey.current = newIdempotencyKey();

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((r) => {
      if (cancelled) return;
      setExisting(isApiFailure(r) ? [] : r.value.businessAccounts.map((a) => a.name));
      if (isApiFailure(r) && r.status === 401) setFailure(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    setFieldErrors({});
    setBusy(true);

    const result = await createWorkspace({
      idempotencyKey: idempotencyKey.current,
      workspace: {
        name,
        businessCategory,
        pickupAddress: pickup,
        contactPhone,
        payerDefault,
        policiesAccepted,
      },
    });

    setBusy(false);
    if (isApiFailure(result)) {
      setFailure(result);
      const out: Record<string, string> = {};
      if (Array.isArray(result.details)) {
        for (const d of result.details as Array<{ code?: string; field?: string }>) {
          if (!d?.code) continue;
          out[d.field ?? d.code] = ERROR_COPY[d.code] ?? "Check this value.";
        }
      }
      setFieldErrors(out);
      return;
    }

    // The workspace exists and the caller is its active owner. Everything the
    // merchant flow needs is now in place.
    router.push("/business");
    router.refresh();
  }

  if (existing === null) {
    return (
      <LoadingState label="Loading your account">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  if (failure?.status === 401) {
    return (
      <EmptyState
        title="Sign in to continue"
        body="Create a Couranr sign-in first, then set up your business."
        action={{ label: "Sign up", href: "/sign-up" }}
      />
    );
  }

  if (existing.length > 0) {
    return (
      <EmptyState
        title="Your workspace is ready"
        body={`You already have access to ${existing.join(", ")}.`}
        action={{ label: "Go to your dashboard", href: "/business" }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap={6}>
        {failure && failure.status !== 401 ? (
          <ErrorState title="Your workspace could not be created" body={withReference(failure)} />
        ) : null}

        <Card>
          <CardHeader
            title="Your business"
            description="Category shapes what Couranr suggests. It does not limit what you can send."
          />
          <Stack gap={3}>
            <Field label="Business name" required error={fieldErrors.name}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Category" required error={fieldErrors.businessCategory}>
              {(p) => (
                <Select
                  {...p}
                  value={businessCategory}
                  onChange={(e) => setBusinessCategory(e.target.value)}
                >
                  <option value="">Choose a category</option>
                  {BUSINESS_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Contact phone" required error={fieldErrors.contactPhone}>
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Card>
          <CardHeader
            title="Primary pickup address"
            description="Where a Couranr driver collects from by default. You can use a different address on any delivery."
          />
          <Stack gap={3}>
            <Field label="Street address" required error={fieldErrors.pickupAddress}>
              {(p) => (
                <Input
                  {...p}
                  value={pickup.line1}
                  onChange={(e) => setPickup({ ...pickup, line1: e.target.value })}
                />
              )}
            </Field>
            <Field label="Suite, unit or floor">
              {(p) => (
                <Input
                  {...p}
                  value={pickup.line2}
                  onChange={(e) => setPickup({ ...pickup, line2: e.target.value })}
                />
              )}
            </Field>
            <Grid columns={3}>
              <Field label="City" required>
                {(p) => (
                  <Input
                    {...p}
                    value={pickup.city}
                    onChange={(e) => setPickup({ ...pickup, city: e.target.value })}
                  />
                )}
              </Field>
              <Field label="State" required>
                {(p) => (
                  <Input
                    {...p}
                    value={pickup.region}
                    onChange={(e) => setPickup({ ...pickup, region: e.target.value })}
                  />
                )}
              </Field>
              <Field label="ZIP" required>
                {(p) => (
                  <Input
                    {...p}
                    value={pickup.postalCode}
                    onChange={(e) => setPickup({ ...pickup, postalCode: e.target.value })}
                  />
                )}
              </Field>
            </Grid>
            <Field label="Pickup notes" hint="Door, dock or counter. Never a password or a gate code you would not write down.">
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  value={pickup.instructions}
                  onChange={(e) => setPickup({ ...pickup, instructions: e.target.value })}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Card>
          <CardHeader
            title="Who pays"
            description="The default for new deliveries. You can change it on any single delivery."
          />
          <Field label="Default payer" required error={fieldErrors.payerDefault}>
            {(p) => (
              <Select
                {...p}
                value={payerDefault}
                onChange={(e) => setPayerDefault(e.target.value)}
              >
                <option value="merchant">My business pays</option>
                <option value="customer">My customer pays</option>
              </Select>
            )}
          </Field>
          <Text size="sm" muted style={{ marginTop: "var(--couranr-space-3)" }}>
            Nothing is charged during setup, and Couranr collects no card
            details on this screen.
          </Text>
        </Card>

        <Card>
          <CardHeader title="Policies" />
          <CheckboxRow
            label="I accept the Couranr delivery policy, terms and privacy policy."
            checked={policiesAccepted}
            onChange={(e) => setPoliciesAccepted(e.target.checked)}
          />
          {fieldErrors.policiesAccepted ? (
            <Text size="sm" style={{ color: "var(--couranr-danger)" }} role="alert">
              {fieldErrors.policiesAccepted}
            </Text>
          ) : null}
        </Card>

        <Alert tone="info" title="This is all Couranr needs to start">
          Payment setup, branding and teammates come later, from your settings.
        </Alert>

        <Cluster gap={3}>
          <Button variant="primary" type="submit" loading={busy}>
            Create my workspace
          </Button>
        </Cluster>
      </Stack>
    </form>
  );
}
