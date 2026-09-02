"use client";

import * as React from "react";
import { Alert, Button, Cluster, Stack } from "@/components/couranr/primitives";
import { Field, Textarea } from "@/components/couranr/forms";
import {
  confirmIntakeFactFromBrowser,
  describeIntake,
  fetchIntake,
  isApiFailure,
  startIntake,
  withReference,
  type ApiFailure,
  type IntakeSessionView,
} from "./client";

/**
 * P5-001 Smart Intake inside MER-005 — the natural-language half of "what are
 * you delivering?".
 *
 * The rules this component lives by:
 *
 *   - the merchant's words are EVIDENCE, preserved verbatim server-side;
 *   - what comes back is labeled by where it came from — "You told us" vs
 *     "Couranr suggested" — and a suggestion carries no authority until the
 *     merchant confirms it;
 *   - ONE question at a time, the highest-impact one, answered inline;
 *   - if interpretation is unavailable the panel says so once and gets out of
 *     the way — the structured form below always works.
 *
 * No confidence percentages are painted on the screen; confidence drives
 * asking behavior, not decoration.
 */

export type IntakeFactRow = Record<string, any>;

const FACT_LABELS: Record<string, string> = {
  merchant_reference: "Reference",
  item_category: "Item",
  item_subtype: "Type",
  quantity: "Quantity",
  package_count: "Packages",
  weight_lb_exact: "Weight (lb)",
  weight_band: "Weight range",
  dimensions_in: "Dimensions",
  size_bulk: "Size",
  declared_value_band: "Declared value",
  fragile: "Fragile",
  temperature_sensitive: "Temperature-sensitive",
  handling_requirements: "Handling",
  loading_uncertainty: "Loading help",
  stairs_access: "Stairs / access",
  setup_breakdown: "Setup or breakdown",
  special_equipment: "Equipment",
  vehicle_requirement: "Vehicle",
  restricted_class: "Restricted item",
  battery_condition: "Battery",
};

const BAND_LABELS: Record<string, string> = {
  "0_25_lb": "Under 25 lb",
  over_25_to_50_lb: "25–50 lb",
  over_50_lb: "Over 50 lb",
  unknown: "Not sure",
};

function factValueLabel(row: IntakeFactRow): string {
  const v = row.value;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (row.fact_key === "weight_band" && typeof v === "string") return BAND_LABELS[v] ?? v;
  return String(v);
}

function isTrusted(row: IntakeFactRow): boolean {
  return row.authority === "confirmed" || row.authority === "overridden";
}

export function SmartIntakePanel(props: {
  businessAccountId: string;
  /**
   * The session the parent flow already remembers. The panel unmounts on the
   * review step; on the way back it must pick its session up again rather
   * than report "no session" and make the parent forget where the shipment
   * facts came from.
   */
  sessionId?: string | null;
  onIntakeChange: (state: { sessionId: string | null; facts: IntakeFactRow[] }) => void;
}) {
  const { businessAccountId, onIntakeChange } = props;
  const rememberedSessionId = props.sessionId ?? null;
  const [description, setDescription] = React.useState("");
  const [intake, setIntake] = React.useState<IntakeSessionView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = React.useState("");

  const session = intake?.session ?? null;
  // A withdrawn fact (authority `unknown`, null value) is not a statement of
  // anything; it never reaches the parent form or the screen.
  const facts = React.useMemo(
    () => (intake?.facts ?? []).filter((f) => f.authority !== "unknown" && f.value !== null),
    [intake]
  );

  // Latest-callback ref: the parent's handler closes over ITS latest form
  // state (it reads `weightLb` to decide whether a field is empty). Calling a
  // captured render's copy would decide from stale values.
  const onIntakeChangeRef = React.useRef(onIntakeChange);
  React.useEffect(() => {
    onIntakeChangeRef.current = onIntakeChange;
  }, [onIntakeChange]);
  // Rehydration is pending while the parent remembers a session this mount
  // has not loaded yet. Reporting `sessionId: null` in that window would wipe
  // the parent's memory — the exact state loss this prop exists to prevent.
  const rehydrating = session === null && rememberedSessionId !== null;
  React.useEffect(() => {
    if (rehydrating) return;
    onIntakeChangeRef.current({ sessionId: session?.id ?? null, facts });
  }, [session?.id, facts, rehydrating]);

  // One place turns a loaded session into panel state, for the actions and
  // for the remount rehydration alike. A remount starts with an empty
  // textarea; the merchant's latest words are the session's evidence, so
  // they are shown again rather than a blank.
  const applyLoaded = React.useCallback((loaded: IntakeSessionView) => {
    setIntake(loaded);
    setDescription((current) => {
      if (current.trim().length > 0) return current;
      const revisions = loaded.revisions ?? [];
      const latest = revisions[revisions.length - 1];
      return typeof latest?.raw_description === "string" ? latest.raw_description : current;
    });
  }, []);

  async function refresh(sessionId: string) {
    const loaded = await fetchIntake({ sessionId, businessAccountId });
    if (!isApiFailure(loaded)) applyLoaded(loaded.value.intake);
  }

  React.useEffect(() => {
    if (!rehydrating || !rememberedSessionId) return;
    let cancelled = false;
    void fetchIntake({ sessionId: rememberedSessionId, businessAccountId }).then((loaded) => {
      if (cancelled) return;
      // Could not rehydrate: say so once and let the parent keep its session
      // — the server resolves the linked session on calculate regardless.
      if (isApiFailure(loaded)) setFailure(loaded);
      else applyLoaded(loaded.value.intake);
    });
    return () => {
      cancelled = true;
    };
  }, [rehydrating, rememberedSessionId, businessAccountId, applyLoaded]);

  async function onOrganize() {
    if (busy || description.trim().length === 0) return;
    setFailure(null);
    setBusy(true);
    const result = session
      ? await describeIntake({
          sessionId: session.id,
          businessAccountId,
          description,
          expectedRevision: Number(session.current_revision),
        })
      : await startIntake({ businessAccountId, description });
    setBusy(false);
    if (isApiFailure(result)) {
      setFailure(result);
      return;
    }
    await refresh(session ? session.id : result.value.session.id);
  }

  async function onConfirmFact(factKey: string, value: unknown) {
    if (!session || busy) return;
    setBusy(true);
    const result = await confirmIntakeFactFromBrowser({
      sessionId: session.id,
      businessAccountId,
      factKey,
      value,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setFailure(result);
      return;
    }
    await refresh(session.id);
  }

  async function onAnswerClarification() {
    if (!session || clarificationAnswer.trim().length === 0) return;
    setBusy(true);
    const result = await describeIntake({
      sessionId: session.id,
      businessAccountId,
      description: clarificationAnswer,
      expectedRevision: Number(session.current_revision),
      isClarificationResponse: true,
    });
    setBusy(false);
    setClarificationAnswer("");
    if (isApiFailure(result)) {
      setFailure(result);
      return;
    }
    await refresh(session.id);
  }

  const clarification = session?.current_clarification ?? null;
  const providerDown =
    session?.interpretation_status === "provider_unavailable" ||
    session?.interpretation_status === "rate_limited" ||
    session?.interpretation_status === "manual";
  const told = facts.filter((f) => isTrusted(f) || f.source === "merchant_statement");
  const suggested = facts.filter((f) => !isTrusted(f) && f.source === "ai_inference");

  return (
    <Stack gap={3}>
      <Field
        label="What are you delivering?"
        hint='For example: "12 boxed flower arrangements, about 20 lb total, keep upright."'
      >
        {(p) => (
          <Textarea
            {...p}
            rows={2}
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <Cluster gap={2}>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || description.trim().length === 0}
          onClick={onOrganize}
        >
          {session ? "Update description" : "Organize with Couranr"}
        </Button>
      </Cluster>

      {failure ? <Alert tone="danger">{withReference(failure)}</Alert> : null}

      {providerDown ? (
        <Alert tone="info">
          Couranr could not organize the description automatically right now — fill in the
          details below and everything works exactly the same.
        </Alert>
      ) : null}

      {facts.length > 0 ? (
        <Stack gap={2}>
          {told.length > 0 ? (
            <div>
              <strong>You told us:</strong>{" "}
              {told
                .filter((f) => FACT_LABELS[f.fact_key])
                .map((f) => `${FACT_LABELS[f.fact_key]}: ${factValueLabel(f)}`)
                .join(" · ")}
            </div>
          ) : null}
          {suggested.length > 0 ? (
            <div>
              <strong>Couranr suggested</strong> (confirm what is right):
              <Cluster gap={2}>
                {suggested
                  .filter((f) => FACT_LABELS[f.fact_key])
                  .map((f) => (
                    <Button
                      key={f.fact_key}
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onConfirmFact(f.fact_key, f.value)}
                    >
                      {FACT_LABELS[f.fact_key]}: {factValueLabel(f)} ✓
                    </Button>
                  ))}
              </Cluster>
            </div>
          ) : null}
        </Stack>
      ) : null}

      {clarification ? (
        <Alert tone="info">
          <Stack gap={2}>
            <div>{clarification.question}</div>
            {clarification.factKey === "weight_band" ? (
              <Cluster gap={2}>
                {(["0_25_lb", "over_25_to_50_lb", "over_50_lb"] as const).map((band) => (
                  <Button
                    key={band}
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onConfirmFact("weight_band", band)}
                  >
                    {BAND_LABELS[band]}
                  </Button>
                ))}
              </Cluster>
            ) : clarification.factKey === "restricted_class" ? (
              // The safety declaration is a structured act, never free text:
              // "none of these" is the only answer that permits an automatic
              // quote, and it has to be the merchant's own click.
              <Cluster gap={2}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onConfirmFact("restricted_class", "none")}
                >
                  None of these — I confirm
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onConfirmFact("restricted_class", "unknown")}
                >
                  Not sure — Couranr will review
                </Button>
              </Cluster>
            ) : (
              <Cluster gap={2}>
                <Textarea
                  rows={1}
                  maxLength={500}
                  value={clarificationAnswer}
                  onChange={(e) => setClarificationAnswer(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || clarificationAnswer.trim().length === 0}
                  onClick={onAnswerClarification}
                >
                  Answer
                </Button>
              </Cluster>
            )}
          </Stack>
        </Alert>
      ) : null}
    </Stack>
  );
}
