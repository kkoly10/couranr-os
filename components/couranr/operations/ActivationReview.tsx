"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { Field, Select } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  call,
  isApiFailure,
  withReference,
  type ApiFailure,
} from "@/components/couranr/requests/client";
import {
  ACKNOWLEDGEMENT_LABELS,
  ACTIVATION_STATES,
  ACTIVATION_STATE_LABELS,
  ACTIVATION_STATE_TONE,
  BLOCK_REASONS,
  BLOCK_REASON_CODES,
  type ActivationState,
} from "@/lib/couranr/activation/states";
import type { ActivationView } from "@/components/couranr/activation/ActivationChecklist";

/**
 * The ACTIVATION REVIEW slice of OPS-007 — Couranr Operations deciding whether
 * a merchant workspace goes live.
 *
 * This is not all of OPS-007. Merchant health, risk, presets, support history
 * and account pause belong to ACP-038 in B06 and are deliberately absent —
 * there is no posted source for merchant performance, and the registry bans
 * fabricating one.
 *
 * It exists because the decide route was WRITE-ONLY: an operator could grant
 * or block a workspace but had no way to see the checklist, the
 * acknowledgements, or who accepted them, and no way to find a workspace
 * awaiting review at all. A decision made blind is not a review.
 *
 * Blocking REQUIRES a reason, and the reason is a CODE from a closed list —
 * the merchant reads a sentence derived from it, never an operator's note.
 * `couranr_decide_activation` refuses a blank reason in SQL too.
 */

type QueueEntry = {
  businessAccountId: string;
  businessName: string;
  state: string;
  requestedAt: string | null;
  blockedReason: string | null;
  reviewedAt: string | null;
};

type AcknowledgementRecord = {
  kind: string;
  version: string;
  acceptedAt: string;
  acceptedByUserId: string;
  acceptedByEmail: string | null;
  isCurrent: boolean;
};

function badgeTone(state: string): "neutral" | "info" | "success" | "warning" {
  return ACTIVATION_STATE_TONE[state as ActivationState] ?? "neutral";
}

export function ActivationReview() {
  const [stateFilter, setStateFilter] = React.useState<string>("pending_couranr_review");
  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [listError, setListError] = React.useState<ApiFailure | null>(null);

  const [selected, setSelected] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ActivationView | null>(null);
  const [acks, setAcks] = React.useState<AcknowledgementRecord[] | null>(null);
  const [detailError, setDetailError] = React.useState<ApiFailure | null>(null);

  const [reasonCode, setReasonCode] = React.useState<string>(BLOCK_REASON_CODES[0] ?? "");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setListError(null);
    call<{ entries: QueueEntry[] }>(
      `/api/couranr/operations/activation?state=${encodeURIComponent(stateFilter)}`
    ).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setListError(r);
        return;
      }
      setEntries(r.value.entries);
    });
    return () => {
      cancelled = true;
    };
  }, [stateFilter, reloadKey]);

  React.useEffect(() => {
    if (!selected) {
      setDetail(null);
      setAcks(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setAcks(null);
    setDetailError(null);
    call<{ activation: ActivationView; acknowledgements: AcknowledgementRecord[] }>(
      `/api/couranr/operations/activation?businessAccountId=${encodeURIComponent(selected)}`
    ).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setDetailError(r);
        return;
      }
      setDetail(r.value.activation);
      setAcks(r.value.acknowledgements);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, reloadKey]);

  async function decide(grant: boolean) {
    if (!selected) return;
    setBusy(grant ? "grant" : "block");
    setActionError(null);
    const r = await call<{ activation: ActivationView }>(
      "/api/couranr/operations/activation",
      {
        method: "POST",
        body: grant
          ? { businessAccountId: selected, action: "grant" }
          : { businessAccountId: selected, action: "block", reasonCode },
      }
    );
    setBusy(null);
    if (isApiFailure(r)) {
      setActionError(withReference(r));
      return;
    }
    setDetail(r.value.activation);
    setReloadKey((k) => k + 1);
  }

  if (listError && listError.status === 403) {
    return (
      <EmptyState
        title="Couranr Operations access required"
        body="Merchant activation review is available to Couranr Operations only."
      />
    );
  }
  if (listError) {
    return (
      <ErrorState
        title="The activation queue did not load"
        body={withReference(listError)}
        action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
      />
    );
  }

  return (
    <Stack gap={6}>
      <Card>
        <CardHeader
          title="Activation review"
          description="Workspaces waiting on a Couranr decision. Nothing here is automatic — a workspace goes live only when an operator grants it."
        />
        <Field label="Showing" required>
          {(p) => (
            <Select
              {...p}
              value={stateFilter}
              onChange={(e) => {
                setSelected(null);
                setStateFilter(e.target.value);
              }}
            >
              {ACTIVATION_STATES.map((s) => (
                <option key={s} value={s}>
                  {ACTIVATION_STATE_LABELS[s]}
                </option>
              ))}
              <option value="all">Every workspace</option>
            </Select>
          )}
        </Field>
      </Card>

      {entries === null ? (
        <LoadingState label="Loading the activation queue">
          <CardSkeleton lines={4} />
        </LoadingState>
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="No workspace is in this state right now."
        />
      ) : (
        <Card>
          <CardHeader title={`${entries.length} workspace${entries.length === 1 ? "" : "s"}`} />
          <Stack gap={3}>
            {entries.map((e) => (
              <Cluster key={e.businessAccountId} gap={2}>
                <Badge tone={badgeTone(e.state)}>
                  {ACTIVATION_STATE_LABELS[e.state as ActivationState] ?? e.state}
                </Badge>
                <Text size="sm">
                  <strong>{e.businessName}</strong>
                </Text>
                {e.requestedAt ? (
                  <Text size="xs" muted>
                    Requested {new Date(e.requestedAt).toLocaleDateString()}
                  </Text>
                ) : null}
                <Button
                  size="sm"
                  variant={selected === e.businessAccountId ? "primary" : undefined}
                  onClick={() =>
                    setSelected(selected === e.businessAccountId ? null : e.businessAccountId)
                  }
                >
                  {selected === e.businessAccountId ? "Close" : "Review"}
                </Button>
              </Cluster>
            ))}
          </Stack>
        </Card>
      )}

      {detailError ? (
        <ErrorState title="That workspace did not load" body={withReference(detailError)} />
      ) : null}

      {selected && !detail && !detailError ? (
        <LoadingState label="Loading the workspace">
          <CardSkeleton lines={5} />
        </LoadingState>
      ) : null}

      {detail ? (
        <Card>
          <CardHeader
            title="What this merchant has done"
            description="Every requirement, as the database holds it — not as the merchant's screen reported it."
            actions={
              <Badge tone={badgeTone(detail.state)}>
                {ACTIVATION_STATE_LABELS[detail.state as ActivationState] ?? detail.state}
              </Badge>
            }
          />
          <Stack gap={4}>
            <Stack gap={2}>
              {detail.requirements.map((r) => (
                <Cluster key={r.id} gap={2}>
                  <Badge tone={r.met ? "success" : "warning"}>{r.met ? "Met" : "Not met"}</Badge>
                  <Text size="sm">{r.label}</Text>
                </Cluster>
              ))}
            </Stack>

            {/*
              The consent record. An operator granting activation is relying on
              these having been accepted, so WHO accepted each one and at which
              VERSION is shown — a consent row whose acceptor is invisible is
              not evidence of anything.
            */}
            <Stack gap={2}>
              <Text size="sm">
                <strong>Accepted documents</strong>
              </Text>
              {acks && acks.length > 0 ? (
                acks.map((a) => (
                  <Cluster key={`${a.kind}-${a.version}-${a.acceptedAt}`} gap={2}>
                    <Badge tone={a.isCurrent ? "success" : "warning"}>
                      {a.isCurrent ? "Current" : "Superseded"}
                    </Badge>
                    <Text size="sm">
                      {ACKNOWLEDGEMENT_LABELS[a.kind as keyof typeof ACKNOWLEDGEMENT_LABELS] ??
                        a.kind}
                    </Text>
                    <Text size="xs" muted>
                      {a.version} · {a.acceptedByEmail ?? a.acceptedByUserId} ·{" "}
                      {new Date(a.acceptedAt).toLocaleDateString()}
                    </Text>
                  </Cluster>
                ))
              ) : (
                <Text size="sm" muted>
                  Nothing accepted yet.
                </Text>
              )}
            </Stack>

            {actionError ? <ErrorState title="That could not be done" body={actionError} /> : null}

            {detail.state === "live" ? (
              <Alert tone="success" title="This workspace is live">
                Deliveries from this merchant are dispatched.
              </Alert>
            ) : (
              <Stack gap={3}>
                {!detail.canRequest && detail.state !== "pending_couranr_review" ? (
                  <Alert tone="info" title="This merchant has not asked yet">
                    They have not completed the checklist, so there is nothing
                    to decide. Granting now would activate a workspace whose
                    terms were never accepted.
                  </Alert>
                ) : null}
                <Cluster gap={3}>
                  <Button
                    variant="primary"
                    loading={busy === "grant"}
                    disabled={Boolean(busy) || detail.state !== "pending_couranr_review"}
                    onClick={() => decide(true)}
                  >
                    Grant activation
                  </Button>
                  <Button
                    loading={busy === "block"}
                    disabled={Boolean(busy) || detail.state !== "pending_couranr_review"}
                    onClick={() => decide(false)}
                  >
                    Block with a reason
                  </Button>
                </Cluster>
                {/*
                  A CODE, from a closed list. The merchant reads a sentence
                  derived from it — an operator's free text is never shown to a
                  merchant, and the SQL refuses a blank reason regardless.
                */}
                <Field label="Reason if blocking" required>
                  {(p) => (
                    <Select
                      {...p}
                      value={reasonCode}
                      onChange={(e) => setReasonCode(e.target.value)}
                    >
                      {BLOCK_REASON_CODES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {/*
                  The operator sees the exact sentence the MERCHANT will read.
                  Choosing a reason without knowing what it says to them is how
                  a curt internal code becomes a merchant's only explanation.
                */}
                <Alert tone="info" title="The merchant will read">
                  {BLOCK_REASONS[reasonCode] ?? ""}
                </Alert>
              </Stack>
            )}
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}
