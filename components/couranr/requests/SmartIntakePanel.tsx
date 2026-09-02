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
  onIntakeChange: (state: { sessionId: string | null; facts: IntakeFactRow[] }) => void;
}) {
  const { businessAccountId, onIntakeChange } = props;
  const [description, setDescription] = React.useState("");
  const [intake, setIntake] = React.useState<IntakeSessionView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = React.useState("");

  const session = intake?.session ?? null;
  const facts = React.useMemo(() => intake?.facts ?? [], [intake]);

  React.useEffect(() => {
    onIntakeChange({ sessionId: session?.id ?? null, facts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, facts]);

  async function refresh(sessionId: string) {
    const loaded = await fetchIntake({ sessionId, businessAccountId });
    if (!isApiFailure(loaded)) setIntake(loaded.value.intake);
  }

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
