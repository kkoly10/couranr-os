"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
  buttonClassName,
} from "@/components/couranr/primitives";
import { Field, Input, Select, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  call,
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import { memberMay } from "@/lib/couranr/settings/permissions";
import {
  PRESET_PURPOSE_COPY,
  SUGGESTABLE_FIELDS,
  isForbiddenPresetKey,
  type PresetBody,
} from "@/lib/couranr/presets/fields";
import {
  PRESET_STATE_DESCRIPTIONS,
  PRESET_STATE_LABELS,
  PRESET_STATE_TONE,
  builderState,
  saveIsBlocked,
  type PresetState,
} from "@/lib/couranr/presets/states";

/**
 * MER-010 presets list, and MER-011 the builder at `?edit=`.
 *
 * One route, two states, exactly as the registry declares them.
 *
 * MER-011's mandatory constraint governs every field on this screen: "Never
 * silently assert exact weight, dimensions, value, final vehicle, price,
 * loading, or safety." There is no input here for any of them — not a
 * disabled one, not a hidden one. The seven fields the form offers are the
 * seven §5 permits, and `SUGGESTABLE_FIELDS` is the list it renders from, so
 * the form cannot drift from the rule.
 */

type PresetView = {
  id: string;
  name: string;
  body: PresetBody;
  version: number;
  state: PresetState;
  archivedAt: string | null;
  sourcePresetId: string | null;
  sourceVersion: number | null;
  currentSourceVersion: number | null;
  updatedAt: string;
};

type GlobalPresetView = {
  id: string;
  name: string;
  body: PresetBody;
  version: number;
  businessCategory: string;
};

type PresetsView = {
  businessAccountId: string;
  presets: PresetView[];
  suggestions: GlobalPresetView[];
};

type WriteResult = { presetId: string; version: number; notice: string | null };

function fetchPresets(businessAccountId: string, includeArchived: boolean) {
  return call<{ presets: PresetsView }>(
    `/api/couranr/merchant/presets?businessAccountId=${encodeURIComponent(businessAccountId)}` +
      (includeArchived ? "&archived=1" : "")
  );
}

function post(businessAccountId: string, body: Record<string, unknown>) {
  return call<{ result: WriteResult }>(
    `/api/couranr/merchant/presets?businessAccountId=${encodeURIComponent(businessAccountId)}`,
    { method: "POST", body }
  );
}

/** The seven fields, with the labels a merchant reads. */
const FIELD_LABELS: Record<string, string> = {
  commonItem: "What you usually send",
  packageCount: "How many packages, usually",
  handling: "Handling notes",
  proofMethod: "Proof you usually need",
  vehicleCapabilities: "What the vehicle needs to handle",
  requiredQuestions: "Ask staff these when creating one",
  payerPreference: "Who usually pays",
};

const PROOF_OPTIONS = [
  { value: "", label: "No preference" },
  { value: "photo_or_pin", label: "Photo or PIN" },
  { value: "signature", label: "Signature" },
];

const PAYER_OPTIONS = [
  { value: "", label: "No preference" },
  { value: "merchant", label: "My business" },
  { value: "customer", label: "The customer" },
];

export function PresetsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingId = searchParams.get("edit");

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [view, setView] = React.useState<PresetsView | null>(null);
  const [viewError, setViewError] = React.useState<ApiFailure | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // The builder's form, and the version it was LOADED at.
  const [form, setForm] = React.useState<{ name: string; body: PresetBody } | null>(null);
  const [loadedVersion, setLoadedVersion] = React.useState<number | null>(null);

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

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    setView(null);
    setViewError(null);
    fetchPresets(businessAccountId, showArchived).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setViewError(r);
        return;
      }
      setView(r.value.presets);
    });
    return () => {
      cancelled = true;
    };
  }, [businessAccountId, showArchived, reloadKey]);

  /*
   * Seed the builder from what the SERVER holds, and remember WHICH VERSION it
   * came from. The loaded version is what the save sends back — never the
   * current one, because the whole conflict check is "has this moved since I
   * looked at it?".
   */
  React.useEffect(() => {
    if (!view || !editingId) {
      setForm(null);
      setLoadedVersion(null);
      return;
    }
    if (editingId === "new") {
      setForm({ name: "", body: {} });
      setLoadedVersion(null);
      return;
    }
    const found = view.presets.find((p) => p.id === editingId);
    if (found) {
      setForm({ name: found.name, body: { ...found.body } });
      setLoadedVersion(found.version);
    }
  }, [view, editingId]);

  async function run(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    const r = await post(businessAccountId, body);
    setBusy(null);
    if (isApiFailure(r)) {
      setActionError(withReference(r));
      setReloadKey((k) => k + 1);
      return null;
    }
    // Never silent: a stripped field is named here.
    if (r.value.result.notice) setNotice(r.value.result.notice);
    setReloadKey((k) => k + 1);
    return r.value.result;
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
      <LoadingState label="Loading your presets">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }
  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to see your presets"
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
        action={{ label: "Set up your workspace", href: "/app/business/onboarding" }}
      />
    );
  }

  const activeAccount =
    accounts.find((a) => a.businessAccountId === businessAccountId) ?? accounts[0];
  const viewer = { role: activeAccount.role, status: "active" };
  const mayWrite = memberMay(viewer, "presets.write");

  const editing = editingId ? view?.presets.find((p) => p.id === editingId) ?? null : null;
  const isNew = editingId === "new";

  /* ─────────────────────────── MER-011 builder ───────────────────────── */

  if (editingId && form) {
    const stored = editing?.version ?? null;
    const dirty =
      !!editing &&
      (form.name !== editing.name ||
        JSON.stringify(form.body) !== JSON.stringify(editing.body));
    const bState = builderState({
      storedVersion: isNew ? null : stored,
      loadedVersion,
      dirty,
      recommendationAvailable: editing?.state === "update_suggested",
    });
    const blocked = saveIsBlocked({
      storedVersion: isNew ? null : stored,
      loadedVersion,
      dirty,
      recommendationAvailable: false,
    });

    function setField(key: string, value: unknown) {
      setForm((f) => (f ? { ...f, body: { ...f.body, [key]: value } as PresetBody } : f));
    }

    return (
      <Stack gap={6}>
        <Cluster gap={3}>
          <Link href="/app/business/presets" className={buttonClassName({ size: "sm" })}>
            Back to presets
          </Link>
          {!isNew && editing ? (
            <Text size="xs" muted>
              Version {editing.version}
            </Text>
          ) : null}
        </Cluster>

        {bState === "version_conflict" ? (
          <Alert tone="warning" title="Someone else saved this preset">
            They saved while you had it open, so saving now would replace their
            work with a version that no longer exists. Reload to see theirs
            before you save yours.
          </Alert>
        ) : null}
        {bState === "recommendation_available" ? (
          <Alert tone="warning" title="Couranr has an update for this preset">
            {PRESET_STATE_DESCRIPTIONS.update_suggested}
          </Alert>
        ) : null}
        {bState === "edited" ? (
          <Alert tone="info" title="Unsaved changes">
            Save to keep them.
          </Alert>
        ) : null}
        {notice ? <Alert tone="info" title="One thing was not saved">{notice}</Alert> : null}
        {actionError ? <ErrorState title="That could not be saved" body={actionError} /> : null}

        <Card>
          <CardHeader
            title={isNew ? "New preset" : `Edit ${editing?.name ?? "preset"}`}
            description={PRESET_PURPOSE_COPY}
          />
          <Stack gap={4}>
            <Field label="Preset name" required>
              {(p) => (
                <Input
                  {...p}
                  value={form.name}
                  disabled={!mayWrite}
                  onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                />
              )}
            </Field>

            {/*
              RENDERED FROM `SUGGESTABLE_FIELDS`, not from a list typed here.
              A field added to the governed module appears; anything else
              cannot, which is what stops this form drifting from the rule
              that a preset never asserts a weight, price or vehicle.
            */}
            {SUGGESTABLE_FIELDS.map((key) => {
              const label = FIELD_LABELS[key] ?? key;
              if (key === "proofMethod" || key === "payerPreference") {
                const options = key === "proofMethod" ? PROOF_OPTIONS : PAYER_OPTIONS;
                return (
                  <Field key={key} label={label}>
                    {(p) => (
                      <Select
                        {...p}
                        value={String((form.body as any)[key] ?? "")}
                        disabled={!mayWrite}
                        onChange={(e) => setField(key, e.target.value)}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                );
              }
              if (key === "packageCount") {
                return (
                  <Field key={key} label={label}>
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        min={1}
                        max={99}
                        value={String((form.body as any)[key] ?? "")}
                        disabled={!mayWrite}
                        onChange={(e) => setField(key, e.target.value)}
                      />
                    )}
                  </Field>
                );
              }
              if (key === "vehicleCapabilities" || key === "requiredQuestions") {
                const items = ((form.body as any)[key] ?? []) as string[];
                return (
                  <Field key={key} label={label} hint="One per line.">
                    {(p) => (
                      <Textarea
                        {...p}
                        rows={3}
                        value={items.join("\n")}
                        disabled={!mayWrite}
                        onChange={(e) =>
                          setField(
                            key,
                            e.target.value.split("\n").map((v) => v.trim()).filter(Boolean)
                          )
                        }
                      />
                    )}
                  </Field>
                );
              }
              return (
                <Field key={key} label={label}>
                  {(p) => (
                    <Input
                      {...p}
                      value={String((form.body as any)[key] ?? "")}
                      disabled={!mayWrite}
                      onChange={(e) => setField(key, e.target.value)}
                    />
                  )}
                </Field>
              );
            })}

            {mayWrite ? (
              <Cluster gap={3}>
                <Button
                  variant="primary"
                  loading={busy === "save"}
                  disabled={Boolean(busy) || blocked || !form.name.trim()}
                  onClick={async () => {
                    const r = isNew
                      ? await run("save", {
                          action: "create",
                          name: form.name,
                          body: form.body,
                        })
                      : await run("save", {
                          action: "update",
                          presetId: editingId,
                          name: form.name,
                          body: form.body,
                          expectedVersion: loadedVersion,
                        });
                    if (r) router.push("/app/business/presets");
                  }}
                >
                  Save preset
                </Button>
                {blocked ? (
                  <Button onClick={() => setReloadKey((k) => k + 1)}>Reload theirs</Button>
                ) : null}
                {bState === "recommendation_available" && editing ? (
                  <Button
                    loading={busy === "adopt"}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run("adopt", {
                        action: "adopt",
                        presetId: editing.id,
                        expectedVersion: editing.version,
                      })
                    }
                  >
                    Take Couranr&rsquo;s update
                  </Button>
                ) : null}
              </Cluster>
            ) : (
              <Alert tone="info" title="You can look, not change">
                Only an owner or a manager can change your business&rsquo;s presets.
              </Alert>
            )}
          </Stack>
        </Card>
      </Stack>
    );
  }

  /* ──────────────────────────── MER-010 list ─────────────────────────── */

  return (
    <Stack gap={6}>
      {accounts.length > 1 ? (
        <Card>
          <CardHeader title="Business account" />
          <Field label="Viewing" required>
            {(p) => (
              <Select
                {...p}
                value={activeAccount.businessAccountId}
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

      <Alert tone="info" title="What a preset does">
        {PRESET_PURPOSE_COPY}
      </Alert>

      {notice ? <Alert tone="info" title="One thing was not saved">{notice}</Alert> : null}
      {actionError ? <ErrorState title="That could not be done" body={actionError} /> : null}

      <Cluster gap={3}>
        {mayWrite ? (
          <Link
            href="/app/business/presets?edit=new"
            className={buttonClassName({ variant: "primary" })}
          >
            New preset
          </Link>
        ) : null}
        <Button size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </Cluster>

      {viewError ? (
        <ErrorState
          title="Your presets did not load"
          body={withReference(viewError)}
          action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
        />
      ) : null}
      {!view && !viewError ? (
        <LoadingState label="Loading your presets">
          <CardSkeleton lines={4} />
        </LoadingState>
      ) : null}

      {view ? (
        <>
          <Card>
            <CardHeader title="Your presets" />
            {view.presets.length === 0 ? (
              <EmptyState
                title="No presets yet"
                body="A preset saves what you usually send so you do not retype it."
              />
            ) : (
              <Stack gap={4}>
                {view.presets.map((p) => (
                  <Stack key={p.id} gap={1}>
                    <Cluster gap={2}>
                      <Badge tone={PRESET_STATE_TONE[p.state] ?? "neutral"}>
                        {PRESET_STATE_LABELS[p.state] ?? p.state}
                      </Badge>
                      <Text size="sm">
                        <strong>{p.name}</strong>
                      </Text>
                      <Text size="xs" muted>
                        Version {p.version}
                      </Text>
                    </Cluster>
                    <Text size="sm" muted>
                      {PRESET_STATE_DESCRIPTIONS[p.state] ?? ""}
                    </Text>
                    <Cluster gap={2}>
                      <Link
                        href={`/app/business/presets?edit=${encodeURIComponent(p.id)}`}
                        className={buttonClassName({ size: "sm" })}
                      >
                        {mayWrite ? "Edit" : "Open"}
                      </Link>
                      {mayWrite ? (
                        <>
                          <Button
                            size="sm"
                            loading={busy === `dup-${p.id}`}
                            disabled={Boolean(busy)}
                            onClick={() =>
                              run(`dup-${p.id}`, {
                                action: "duplicate",
                                presetId: p.id,
                                name: `${p.name} copy`,
                              })
                            }
                          >
                            Duplicate
                          </Button>
                          <Button
                            size="sm"
                            loading={busy === `arch-${p.id}`}
                            disabled={Boolean(busy)}
                            onClick={() =>
                              run(`arch-${p.id}`, {
                                action: p.archivedAt ? "restore" : "archive",
                                presetId: p.id,
                              })
                            }
                          >
                            {p.archivedAt ? "Restore" : "Archive"}
                          </Button>
                        </>
                      ) : null}
                    </Cluster>
                  </Stack>
                ))}
              </Stack>
            )}
          </Card>

          {/*
            MER-010's "global recommendation" state: Couranr's suggestions for
            this merchant's categories that they have not taken. One they
            customized is already in the list above, and showing it twice
            would read as two presets.
          */}
          {view.suggestions.length > 0 ? (
            <Card>
              <CardHeader
                title="Couranr suggestions"
                description="For the kinds of business you chose. Take one and it becomes yours to change."
              />
              <Stack gap={3}>
                {view.suggestions.map((g) => (
                  <Cluster key={g.id} gap={2}>
                    <Badge tone="info">{PRESET_STATE_LABELS.couranr_global}</Badge>
                    <Text size="sm">
                      <strong>{g.name}</strong>
                    </Text>
                    {mayWrite ? (
                      <Button
                        size="sm"
                        loading={busy === `take-${g.id}`}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          run(`take-${g.id}`, {
                            action: "create",
                            name: g.name,
                            body: g.body,
                            sourcePresetId: g.id,
                          })
                        }
                      >
                        Make it mine
                      </Button>
                    ) : null}
                  </Cluster>
                ))}
              </Stack>
            </Card>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
