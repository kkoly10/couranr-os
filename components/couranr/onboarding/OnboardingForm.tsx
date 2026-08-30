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
import { MAX_SECONDARY_CATEGORIES } from "@/lib/couranr/categories/registry";
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

  /**
   * Account-existence status.
   *
   * "unknown" is a REAL state, distinct from "none". The form must never be
   * offered while account existence is unknown: a failed lookup used to
   * collapse to an empty list, which invited an established merchant to create
   * a second workspace on a transient error.
   */
  const [lookup, setLookup] = React.useState<
    | { status: "loading" }
    | { status: "none" }
    | { status: "exists"; names: string[] }
    | { status: "unauthenticated" }
    | { status: "failed"; failure: ApiFailure }
  >({ status: "loading" });
  const [name, setName] = React.useState("");
  const [businessCategory, setBusinessCategory] = React.useState("");
  const [secondaryCategories, setSecondaryCategories] = React.useState<string[]>([]);
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

  const cancelledRef = React.useRef(false);

  /** Re-runs the lookup in place. No page reload, no lost form input. */
  const loadAccounts = React.useCallback(async () => {
    setLookup({ status: "loading" });
    const r = await fetchMyBusinessAccounts();
    if (cancelledRef.current) return;

    if (isApiFailure(r)) {
      // 401 is a known, actionable state. Everything else — offline, 5xx, a
      // malformed body — leaves account existence UNKNOWN, and unknown is not
      // "none".
      setLookup(r.status === 401 ? { status: "unauthenticated" } : { status: "failed", failure: r });
      return;
    }

    const names = r.value.businessAccounts.map((a) => a.name);
    setLookup(names.length > 0 ? { status: "exists", names } : { status: "none" });
  }, []);

  React.useEffect(() => {
    cancelledRef.current = false;
    loadAccounts();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadAccounts]);

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
        secondaryCategories,
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
    router.push("/app/business");
    router.refresh();
  }

  if (lookup.status === "loading") {
    return (
      <LoadingState label="Loading your account">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  if (lookup.status === "unauthenticated") {
    return (
      <EmptyState
        title="Sign in to continue"
        body="Create a Couranr sign-in first, then set up your business."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }

  /**
   * Account existence is UNKNOWN. Offer a retry and nothing else — in
   * particular, not the form, because submitting it could create a second
   * workspace for a merchant who already has one.
   */
  if (lookup.status === "failed") {
    return (
      <ErrorState
        title="We could not check your account"
        body={withReference(lookup.failure)}
        action={{ label: "Try again", onClick: loadAccounts }}
      />
    );
  }

  if (lookup.status === "exists") {
    return (
      <EmptyState
        title="Your workspace is ready"
        body={`You already have access to ${lookup.names.join(", ")}.`}
        action={{ label: "Go to your dashboard", href: "/app/business" }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap={6}>
        {failure ? (
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
                  onChange={(e) => {
                    const next = e.target.value;
                    setBusinessCategory(next);
                    // Keep the two lists from ever colliding, rather than
                    // letting the merchant submit a pair the server refuses.
                    setSecondaryCategories((prev) => prev.filter((v) => v !== next));
                  }}
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

            {/*
              Up to three more (Master Package section 5). Only offered once a
              primary exists — asking "what else?" before "what?" is a form
              that reads out of order, and every option here has to exclude
              the primary anyway.
            */}
            {businessCategory ? (
              <Stack gap={1}>
                <Text size="sm">
                  <strong>Also (up to {MAX_SECONDARY_CATEGORIES})</strong>{" "}
                  <Text as="span" size="xs" muted>
                    Optional · {secondaryCategories.length} of{" "}
                    {MAX_SECONDARY_CATEGORIES} chosen
                  </Text>
                </Text>
                {BUSINESS_CATEGORIES.filter((c) => c.value !== businessCategory).map((c) => {
                  const chosen = secondaryCategories.includes(c.value);
                  const full = secondaryCategories.length >= MAX_SECONDARY_CATEGORIES;
                  return (
                    <CheckboxRow
                      key={c.value}
                      label={c.label}
                      checked={chosen}
                      disabled={!chosen && full}
                      onChange={() =>
                        setSecondaryCategories((prev) =>
                          prev.includes(c.value)
                            ? prev.filter((v) => v !== c.value)
                            : [...prev, c.value]
                        )
                      }
                    />
                  );
                })}
              </Stack>
            ) : null}

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
