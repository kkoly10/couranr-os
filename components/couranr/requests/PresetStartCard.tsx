"use client";

/**
 * "Start from a saved preset" on the New Delivery form.
 *
 * A merchant who sends the same kind of delivery every week should not retype
 * it. That is the whole promise, and it is a CONVENIENCE: everything this fills
 * lands in ordinary form fields the merchant can still change, and the request
 * then travels exactly the validation, pricing and eligibility path a
 * hand-typed one travels. A preset never decides anything.
 *
 * Three behaviours here exist because of how this goes wrong otherwise:
 *
 *   * The list is fetched when the card is OPENED, not when the page mounts. A
 *     delivery form can sit open for an hour; a list captured at mount keeps
 *     offering a preset that has since been archived or edited.
 *   * The body applied comes from a SECOND call, made at the moment of
 *     application, resolved server-side by id. The picker's copy is never what
 *     fills the form — so a stale tab applies today's preset or is told it
 *     cannot, and can never apply yesterday's.
 *   * What was filled, and what was left alone, is stated afterwards. A form
 *     that silently changes under someone is worse than one that does nothing.
 */

import * as React from "react";
import { Alert, Button, Card, CardHeader, Cluster, Stack, Text } from "@/components/couranr/primitives";
import { Field, Select } from "@/components/couranr/forms";
import {
  fetchPresetForApplication,
  fetchPresetsForDelivery,
  isApiFailure,
  withReference,
  type ApiFailure,
  type ApplicablePresetOption,
} from "./client";

export type ResolvedPreset = { id: string; name: string; version: number; body: unknown };

/** What the flow reports back after applying, in merchant language. */
export type PresetApplicationOutcome = {
  presetName: string;
  filled: string[];
  /** Left alone because the merchant had already typed something there. */
  keptAsEntered: string[];
  /**
   * Carried by the preset but never applied by this build — reported on its own
   * line, because saying "left as you entered them" about a field the merchant
   * never touched would be the form telling them something untrue.
   */
  notApplied: string[];
};

export function PresetStartCard({
  businessAccountId,
  onApply,
}: {
  businessAccountId: string;
  /** The flow owns form state, so it decides what a resolved preset changes. */
  onApply: (preset: ResolvedPreset) => PresetApplicationOutcome;
}) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ApplicablePresetOption[] | null>(null);
  const [chosen, setChosen] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [outcome, setOutcome] = React.useState<PresetApplicationOutcome | null>(null);

  /*
   * Deliberately does NOT clear `failure`. This is called again right after an
   * apply fails, to drop the dead option from the list — and clearing here wiped
   * the very message explaining why the merchant's pick did nothing. A failure
   * is cleared when the card is opened, or replaced by the next one.
   */
  const load = React.useCallback(() => {
    setOptions(null);
    fetchPresetsForDelivery({ businessAccountId }).then((r) => {
      if (isApiFailure(r)) {
        // Unknown, not empty. Showing "no presets yet" for a failed lookup
        // would tell a merchant their saved work is gone.
        setFailure(r);
        return;
      }
      setOptions(r.value.presets.mine ?? []);
    });
  }, [businessAccountId]);

  function openCard() {
    setOpen(true);
    setOutcome(null);
    setFailure(null);
    load();
  }

  function apply() {
    if (!chosen || busy) return;
    setBusy(true);
    setFailure(null);
    // A previous success must not sit next to a new failure still claiming the
    // form was filled in.
    setOutcome(null);
    fetchPresetForApplication({ businessAccountId, presetId: chosen })
      .then((r) => {
        if (isApiFailure(r)) {
          // A preset archived or deleted since the list loaded lands here. The
          // merchant is told, and the list is refreshed so the dead option
          // stops being offered.
          setFailure(r);
          setChosen("");
          load();
          return;
        }
        setOutcome(onApply(r.value.preset));
      })
      .finally(() => setBusy(false));
  }

  if (!open) {
    return (
      <Cluster gap={2}>
        <Button variant="ghost" type="button" onClick={openCard} data-testid="preset-start-open">
          Start from a saved preset
        </Button>
      </Cluster>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Start from a saved preset"
        description="Fills in what you usually send. You can change anything before submitting, and the price is still worked out from this delivery."
      />
      <Stack gap={3}>
        {failure ? (
          <Alert tone="warning" title="That preset could not be used">
            {failure.status === 404
              ? "It may have been archived or removed. Pick another one."
              : withReference(failure)}
          </Alert>
        ) : null}

        {options === null && !failure ? <Text muted>Loading your presets…</Text> : null}

        {options !== null && options.length === 0 ? (
          <Text muted data-testid="preset-start-empty">
            You have not saved any presets yet. You can create one from Presets in your business
            settings.
          </Text>
        ) : null}

        {options !== null && options.length > 0 ? (
          <>
            <Field label="Which preset?">
              {(p) => (
                <Select
                  {...p}
                  value={chosen}
                  data-testid="preset-start-select"
                  onChange={(e) => setChosen(e.target.value)}
                >
                  <option value="">Choose a preset</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Cluster gap={2}>
              <Button
                variant="secondary"
                type="button"
                loading={busy}
                disabled={!chosen}
                onClick={apply}
                data-testid="preset-start-apply"
              >
                Use this preset
              </Button>
              <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </Cluster>
          </>
        ) : null}

        {outcome ? (
          <Alert tone="success" title={`Filled in from “${outcome.presetName}”`}>
            <Stack gap={1}>
              {outcome.filled.length > 0 ? (
                <Text data-testid="preset-start-filled">
                  Filled: {outcome.filled.join(", ")}.
                </Text>
              ) : (
                <Text data-testid="preset-start-filled">
                  Nothing was changed — everything this preset fills was already entered.
                </Text>
              )}
              {outcome.keptAsEntered.length > 0 ? (
                <Text muted data-testid="preset-start-kept">
                  Left as you entered them: {outcome.keptAsEntered.join(", ")}.
                </Text>
              ) : null}
              {outcome.notApplied.length > 0 ? (
                <Text muted data-testid="preset-start-not-applied">
                  Not filled in: {outcome.notApplied.join(", ")}. These are always set on the
                  delivery itself.
                </Text>
              ) : null}
            </Stack>
          </Alert>
        ) : null}
      </Stack>
    </Card>
  );
}
