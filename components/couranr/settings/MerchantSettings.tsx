"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  buttonClassName,
} from "@/components/couranr/primitives";
import { CheckboxRow, Field, Input, Select } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import { fetchSettings, saveSettings, type WorkspaceSettingsView } from "./client";
import { BUSINESS_CATEGORIES } from "@/lib/couranr/onboarding/workspace";
import {
  CATEGORY_PURPOSE_COPY,
  MAX_SECONDARY_CATEGORIES,
} from "@/lib/couranr/categories/registry";
import { memberMay } from "@/lib/couranr/settings/permissions";

/**
 * MER-014 — merchant settings.
 *
 * Registry-required states: SAVED, UNSAVED, VERIFICATION REQUIRED, PERMISSION
 * DENIED. Each one below is a real branch over real data, not a mode flag.
 *
 * What is deliberately NOT here:
 *  - No subscription or plan controls. The registry constraint for this screen
 *    says so outright, and billing is MER-016's screen.
 *  - No editable delivery policies. The locked policy registry wins over any
 *    mock: the policy version is DISPLAYED and the acceptance date with it, and
 *    there is no control that could change either.
 *  - No notification toggles. No table and no decision record exists for
 *    notification preferences, and a switch that persists nowhere is worse than
 *    an honest sentence saying where to configure them.
 *  - No prices anywhere. Pricing is governed and is not a per-merchant setting.
 */

const PAYER_LABELS: Record<string, string> = {
  merchant: "My business pays",
  customer: "My customer pays",
};

type AddressForm = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  instructions: string;
};

const EMPTY_ADDRESS: AddressForm = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  instructions: "",
};

function addressFrom(raw: any): AddressForm {
  const a = { ...EMPTY_ADDRESS };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(a) as (keyof AddressForm)[]) {
      if (typeof raw[k] === "string") a[k] = raw[k];
    }
  }
  return a;
}

export function MerchantSettings() {
  const router = useRouter();

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [view, setView] = React.useState<WorkspaceSettingsView | null>(null);
  const [viewError, setViewError] = React.useState<ApiFailure | null>(null);

  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [secondary, setSecondary] = React.useState<string[]>([]);
  const [phone, setPhone] = React.useState("");
  const [payerDefault, setPayerDefault] = React.useState("merchant");
  const [address, setAddress] = React.useState<AddressForm>({ ...EMPTY_ADDRESS });

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setAccountsError(r);
        if (r.status === 401) setAccounts([]);
        return;
      }
      setAccounts(r.value.businessAccounts);
      if (r.value.businessAccounts.length >= 1) {
        setBusinessAccountId(r.value.businessAccounts[0].businessAccountId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Seeds the form from what the SERVER holds, every time it is (re)read. */
  const applyView = React.useCallback((v: WorkspaceSettingsView) => {
    setView(v);
    setName(v.name);
    setCategory(v.workspace?.businessCategory ?? "");
    setSecondary(v.workspace?.secondaryCategories ?? []);
    setPhone(v.workspace?.contactPhone ?? "");
    setPayerDefault(v.workspace?.payerDefault ?? "merchant");
    setAddress(addressFrom(v.workspace?.pickupAddress));
  }, []);

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    setView(null);
    setViewError(null);
    setSavedAt(null);
    fetchSettings(businessAccountId).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setViewError(r);
        return;
      }
      applyView(r.value);
    });
    return () => {
      cancelled = true;
    };
  }, [businessAccountId, reloadKey, applyView]);

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
      <LoadingState label="Loading your settings">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }
  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to see your settings"
        body="You need to be signed in to a Couranr business account."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No business account yet"
        body="Set up your business workspace first."
        action={{ label: "Set up your workspace", href: "/business/onboarding" }}
      />
    );
  }

  // REQUIRED STATE: permission denied. The route refuses a non-member with 403;
  // a member whose role cannot even read lands here too.
  if (viewError && viewError.status === 403) {
    return (
      <EmptyState
        title="You do not have access to these settings"
        body="Ask an owner or manager of this business if you need access."
      />
    );
  }
  if (viewError) {
    return (
      <ErrorState
        title="Your settings did not load"
        body={withReference(viewError)}
        action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
      />
    );
  }
  if (view === null) {
    return (
      <LoadingState label="Loading your settings">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }

  const mayWrite = memberMay(view.viewer, "settings.write");

  const dirty =
    name !== view.name ||
    category !== (view.workspace?.businessCategory ?? "") ||
    JSON.stringify(secondary) !==
      JSON.stringify(view.workspace?.secondaryCategories ?? []) ||
    phone !== (view.workspace?.contactPhone ?? "") ||
    payerDefault !== (view.workspace?.payerDefault ?? "merchant") ||
    JSON.stringify(address) !== JSON.stringify(addressFrom(view.workspace?.pickupAddress));

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const r = await saveSettings({
      businessAccountId,
      name,
      businessCategory: category,
      secondaryCategories: secondary,
      pickupAddress: address,
      contactPhone: phone,
      payerDefault,
    });
    setSaving(false);
    if (isApiFailure(r)) {
      setSaveError(withReference(r));
      return;
    }
    // Re-seed from the SERVER's answer, so what is shown is what was stored.
    applyView(r.value);
    setSavedAt(Date.now());
  }

  return (
    <Stack gap={6}>
      {accounts.length > 1 ? (
        <Card>
          <CardHeader title="Business account" />
          <Field label="Viewing" required>
            {(p) => (
              <Select
                {...p}
                value={businessAccountId}
                onChange={(e) => setBusinessAccountId(e.target.value)}
              >
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

      {/*
        REQUIRED STATE: verification required.

        No verification mechanism exists in the code or in any decision record,
        so this does NOT invent one. What it reports is the real, reachable
        condition of the same shape: a business account with no Couranr
        workspace profile, which cannot be operated on until Couranr completes
        it. Saying more than that would be inventing a process.
      */}
      {view.workspace === null ? (
        <Alert tone="warning" title="This business needs Couranr verification">
          This account does not have a Couranr workspace profile yet, so pickup
          defaults and delivery settings cannot be edited. Couranr Support can
          complete it.
        </Alert>
      ) : null}

      {!mayWrite ? (
        <Alert tone="info" title="You have read-only access">
          Your role can view these settings but not change them. An owner or
          manager of this business can make changes.
        </Alert>
      ) : null}

      {saveError ? <ErrorState title="That could not be saved" body={saveError} /> : null}

      <form onSubmit={onSave} noValidate>
        <Stack gap={6}>
          <Card>
            <CardHeader
              title="Business profile"
              actions={
                /* REQUIRED STATES: saved and unsaved, as a live badge. */
                dirty ? (
                  <Badge tone="warning">Unsaved changes</Badge>
                ) : savedAt ? (
                  <Badge tone="success">Saved</Badge>
                ) : null
              }
            />
            <Stack gap={3}>
              <Field label="Business name" required>
                {(p) => (
                  <Input
                    {...p}
                    value={name}
                    disabled={!mayWrite}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Grid columns={2}>
                <Field label="Couranr link name" hint="Set by Couranr. Used for your request link.">
                  {(p) => <Input {...p} value={view.slug ?? "Not set yet"} readOnly disabled />}
                </Field>
                <Field label="Time zone" hint="Couranr operates on Eastern time.">
                  {(p) => <Input {...p} value={view.timezone} readOnly disabled />}
                </Field>
              </Grid>
            </Stack>
          </Card>

          {view.workspace ? (
            <>
              <Card>
                <CardHeader
                  title="Pickup defaults"
                  description="Where Couranr collects from, unless a delivery says otherwise."
                />
                <Stack gap={3}>
                  <Field label="Street address" required>
                    {(p) => (
                      <Input
                        {...p}
                        value={address.line1}
                        disabled={!mayWrite}
                        onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Suite, unit or floor">
                    {(p) => (
                      <Input
                        {...p}
                        value={address.line2}
                        disabled={!mayWrite}
                        onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                      />
                    )}
                  </Field>
                  <Grid columns={3}>
                    <Field label="City" required>
                      {(p) => (
                        <Input
                          {...p}
                          value={address.city}
                          disabled={!mayWrite}
                          onChange={(e) => setAddress({ ...address, city: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="State" required>
                      {(p) => (
                        <Input
                          {...p}
                          value={address.region}
                          disabled={!mayWrite}
                          onChange={(e) => setAddress({ ...address, region: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="ZIP" required>
                      {(p) => (
                        <Input
                          {...p}
                          value={address.postalCode}
                          disabled={!mayWrite}
                          onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
                        />
                      )}
                    </Field>
                  </Grid>
                  <Field
                    label="Access notes"
                    hint="Gate codes and door instructions. Never a password."
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={address.instructions}
                        disabled={!mayWrite}
                        onChange={(e) =>
                          setAddress({ ...address, instructions: e.target.value })
                        }
                      />
                    )}
                  </Field>
                  <Field label="Contact phone" required>
                    {(p) => (
                      <Input
                        {...p}
                        value={phone}
                        disabled={!mayWrite}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    )}
                  </Field>
                </Stack>
              </Card>

              <Grid columns={2}>
                <Card>
                  <CardHeader
                    title="Business category"
                    description={CATEGORY_PURPOSE_COPY}
                  />
                  <Stack gap={3}>
                    <Field label="Primary category" required>
                      {(p) => (
                        <Select
                          {...p}
                          value={category}
                          disabled={!mayWrite}
                          onChange={(e) => {
                            const next = e.target.value;
                            setCategory(next);
                            // A secondary that becomes the primary would be
                            // refused by the command AND by a CHECK. Dropping
                            // it here means the merchant sees the consequence
                            // of their own change instead of an error about a
                            // field they did not touch.
                            setSecondary((prev) => prev.filter((v) => v !== next));
                          }}
                        >
                          {BUSINESS_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>

                    {/*
                      Up to three more (Master Package section 5). Checkboxes
                      rather than a multi-select: a merchant has to be able to
                      SEE which are chosen and how many remain, and a
                      multi-select on a phone hides both.
                    */}
                    <Stack gap={1}>
                      <Text size="sm">
                        <strong>
                          Also (up to {MAX_SECONDARY_CATEGORIES})
                        </strong>{" "}
                        <Text as="span" size="xs" muted>
                          {secondary.length} of {MAX_SECONDARY_CATEGORIES} chosen
                        </Text>
                      </Text>
                      {BUSINESS_CATEGORIES.filter((c) => c.value !== category).map((c) => {
                        const chosen = secondary.includes(c.value);
                        const full = secondary.length >= MAX_SECONDARY_CATEGORIES;
                        return (
                          <CheckboxRow
                            key={c.value}
                            label={c.label}
                            checked={chosen}
                            // A box that cannot be ticked is DISABLED rather
                            // than silently ignored on submit.
                            disabled={!mayWrite || (!chosen && full)}
                            onChange={() =>
                              setSecondary((prev) =>
                                prev.includes(c.value)
                                  ? prev.filter((v) => v !== c.value)
                                  : [...prev, c.value]
                              )
                            }
                          />
                        );
                      })}
                    </Stack>
                  </Stack>
                </Card>

                <Card>
                  <CardHeader
                    title="Who usually pays"
                    description="A default only — you choose the payer on every delivery."
                  />
                  <Field label="Default payer" required>
                    {(p) => (
                      <Select
                        {...p}
                        value={payerDefault}
                        disabled={!mayWrite}
                        onChange={(e) => setPayerDefault(e.target.value)}
                      >
                        <option value="merchant">{PAYER_LABELS.merchant}</option>
                        <option value="customer">{PAYER_LABELS.customer}</option>
                      </Select>
                    )}
                  </Field>
                </Card>
              </Grid>
            </>
          ) : null}

          {mayWrite && view.workspace ? (
            <Cluster gap={3}>
              <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
                Save changes
              </Button>
              {dirty ? (
                <Button variant="ghost" disabled={saving} onClick={() => applyView(view)}>
                  Discard changes
                </Button>
              ) : null}
            </Cluster>
          ) : null}
        </Stack>
      </form>

      {/* Read-only, always. The locked policy registry wins over any mock. */}
      <Card>
        <CardHeader
          title="Delivery policies"
          description="Set by Couranr and applied to every delivery."
        />
        <Stack gap={2}>
          <Text size="sm">
            Policy version{" "}
            <strong>{view.workspace?.policiesVersion ?? "not recorded"}</strong>
            {view.workspace?.policiesAcceptedAt
              ? `, accepted ${new Date(view.workspace.policiesAcceptedAt).toLocaleDateString()}`
              : ""}
            .
          </Text>
          <Text size="sm" muted>
            Cancellation, returns, waiting time and proof requirements follow the
            Couranr policy registry. They are not configured per business.
          </Text>
        </Stack>
      </Card>

      <Grid columns={2}>
        <Card>
          <CardHeader title="Notifications" />
          {/*
            Honest empty state. No notification-preference storage exists
            anywhere in the system and no decision record defines one, so there
            is no toggle here — a switch that persisted nowhere would be a lie
            told once per visit.
          */}
          <Stack gap={2}>
            <Text size="sm" muted>
              Operational notification preferences are not yet self-service.
              Couranr Support configures them for your business.
            </Text>
            <div>
              <Link href="/business/messages" className={buttonClassName({ size: "sm" })}>
                Message Couranr Support
              </Link>
            </div>
          </Stack>
        </Card>

        <Card>
          <CardHeader title="Team access" />
          <Stack gap={2}>
            <Text size="sm" muted>
              Who can sign in to this business, and what each role may do.
            </Text>
            <div>
              <Link href="/business/settings/team" className={buttonClassName({ size: "sm" })}>
                Manage team
              </Link>
            </div>
          </Stack>
        </Card>
      </Grid>
    </Stack>
  );
}
