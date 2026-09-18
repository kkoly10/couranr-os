"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Divider,
  Grid,
  Stack,
  Table,
  TableScroll,
  Text,
} from "@/components/couranr/primitives";
import { Field, Input, Select } from "@/components/couranr/forms";
import {
  CardSkeleton,
  ConflictState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  fetchAvailability,
  setMarketActive,
  setMarketAvailability,
  setOperationalFlag,
  openOperatingClosure,
  liftOperatingClosure,
  type Availability,
  type AvailabilityStateId,
  type OperationalFlagKeyId,
} from "./client";

/* ── the governed half: read straight from the modules that own the numbers ── */
import {
  OPERATING_DAYS_COPY,
  OPERATING_WINDOW_COPY,
  OVERNIGHT_WINDOW_COPY,
  SAME_DAY_CUTOFF_COPY,
  SERVICE_LEVEL_CENTS,
  dollars,
} from "@/lib/couranr/public/governed";
import { COURANR_TIMEZONE } from "@/lib/couranr/hours/operatingHours";

/**
 * OPS-016 — availability controls.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SCREEN IS IN TWO HALVES, AND THE LINE BETWEEN THEM IS THE POINT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * GOVERNED — days, window, cutoff, timezone, overnight window and surcharge.
 * Rendered, never edited, and **not fetched**. Every value is imported from the
 * module that already carries the decision:
 *
 *   OPERATING_DAYS_COPY / OPERATING_WINDOW_COPY / SAME_DAY_CUTOFF_COPY
 *   OVERNIGHT_WINDOW_COPY / SERVICE_LEVEL_CENTS.overnight
 *                                    lib/couranr/public/governed.ts  (HRS-001,
 *                                                        HRS-002, OVN-001)
 *   COURANR_TIMEZONE                 lib/couranr/hours/operatingHours.ts
 *                                                                  (HRS-002)
 *
 * `tests/couranr-public-claims.test.ts` already asserts `governed.ts` agrees
 * with the root `02_DECISION_REGISTRY.json`, and
 * `tests/couranr-operations-settings.test.ts` re-asserts the specific records
 * this screen renders. So the chain from registry to pixel is checked at both
 * ends, and there is no literal "4:00 PM" or "6 AM" anywhere in this file —
 * OPS-015's "No mock value overrides the Decision Registry" is a property of
 * the imports, not a promise in a comment.
 *
 * OPERATIONAL — market mode, market on/off, closures and FLG-001's four
 * switches. These are Operations' to change, they live in the database, and
 * every change is a named command that writes an append-only audit row.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FIVE STATES OPS-016 DECLARES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Standard / scheduled only / temporarily closed / weather limited — the
 *   market's `availabilityState`, one closed vocabulary, shown as a badge and
 *   changed through the select.
 *
 *   Overnight enabled — NOT a sixth market state. OVN-001 makes overnight a
 *   request-only capability Couranr enables, and FLG-001 lists
 *   `overnight_enabled` among the four switches with
 *   `availability_states_are_operational_not_flags: true`. It is therefore a
 *   flag, and a market can be weather-limited AND overnight-enabled at once —
 *   a combination a single enum could not express.
 */

const STATE_LABELS: Record<AvailabilityStateId, string> = {
  standard: "Standard",
  scheduled_only: "Scheduled only",
  temporarily_closed: "Temporarily closed",
  weather_limited: "Weather limited",
};

const STATE_TONES: Record<AvailabilityStateId, "success" | "info" | "danger" | "warning"> = {
  standard: "success",
  scheduled_only: "info",
  temporarily_closed: "danger",
  weather_limited: "warning",
};

/**
 * FLG-001's four switches, with the authority each one cites and what turning
 * it on or off actually means. The copy is descriptive, never a promise: a
 * switch is a capability gate, and none of these grants anything the
 * downstream command would otherwise refuse.
 */
const FLAG_COPY: Record<
  OperationalFlagKeyId,
  { label: string; authority: string; body: string; onIsSafe: boolean }
> = {
  overnight_enabled: {
    label: "Overnight requests",
    authority: "FLG-001 · OVN-001",
    body: `Overnight covers ${OVERNIGHT_WINDOW_COPY} and is request-only: Couranr enables it and confirms each one, and it never stacks with rush. Surcharge ${dollars(
      SERVICE_LEVEL_CENTS.overnight
    )}. The mechanism for requesting and confirming an overnight is not specified yet (OVN-002), so this switch gates availability and nothing more.`,
    onIsSafe: true,
  },
  ai_auto_reply_enabled: {
    label: "AI auto-replies",
    authority: "FLG-001",
    body: "Off, Couranr may still draft a reply for a person to send. On, an approved category may send without a person, and only when every deterministic gate passes.",
    onIsSafe: false,
  },
  request_intake_paused: {
    label: "Pause request intake",
    authority: "FLG-001",
    body: "On, Couranr stops accepting new delivery requests. Requests already in flight are unaffected.",
    onIsSafe: false,
  },
  ai_global_kill_switch: {
    label: "AI global kill switch",
    authority: "FLG-001",
    body: "On, every AI path stops immediately, including drafting. This is the blunt control; use it when something is wrong and the category is not yet known.",
    onIsSafe: false,
  },
};

type Busy = { kind: "market" | "flag" | "closure"; key: string } | null;

/**
 * Close a market for one local calendar date.
 *
 * Its own component so the two inputs have their own state and a failed
 * submission does not clear what the operator typed. The date is a plain
 * `type="date"` value — `YYYY-MM-DD` in the browser's own format, which is
 * what `couranr_operating_closures.local_date` holds, and the server rejects
 * anything else rather than casting it in whatever zone it happens to run in.
 */
function ClosureForm({
  marketKey,
  busy,
  onSubmit,
}: {
  marketKey: string;
  busy: boolean;
  onSubmit: (localDate: string, reason: string) => void;
}) {
  const [localDate, setLocalDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const ready = localDate !== "" && reason.trim() !== "";

  return (
    <Grid columns={3}>
      <Field label="Closure date" hint={`Local date in ${COURANR_TIMEZONE}.`}>
        {(p) => (
          <Input
            {...p}
            type="date"
            value={localDate}
            disabled={busy}
            onChange={(e) => setLocalDate(e.target.value)}
          />
        )}
      </Field>
      <Field label="Reason" hint="Shown to Couranr Operations only.">
        {(p) => (
          <Input
            {...p}
            type="text"
            maxLength={200}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <Stack gap={2}>
        <Text size="sm" muted>
          Closing a day removes it from automatic planning for {marketKey}.
        </Text>
        <Button
          variant="primary"
          disabled={!ready || busy}
          onClick={() => onSubmit(localDate, reason.trim())}
        >
          Close this day
        </Button>
      </Stack>
    </Grid>
  );
}

export function AvailabilityControls() {
  const [view, setView] = React.useState<Availability | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [denied, setDenied] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [auditGap, setAuditGap] = React.useState(false);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [generation, setGeneration] = React.useState(0);

  const reload = React.useCallback(async () => {
    const r = await fetchAvailability();
    if (isApiFailure(r)) {
      if (r.status === 401 || r.status === 403) {
        setDenied(true);
        setView(null);
        return;
      }
      setView(null);
      setLoadError(withReference(r));
      return;
    }
    setDenied(false);
    setLoadError(null);
    // The route nests under `availability`. Reading it flat here is the exact
    // shape of the bug that killed proof upload, so the key is named.
    setView(r.value.availability);
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload, generation]);

  /** One place for every command outcome, so no branch forgets a state. */
  async function run(
    busyKey: Busy,
    fn: () => Promise<any>,
    savedMessage: string
  ): Promise<void> {
    setBusy(busyKey);
    setSaved(null);
    setActionError(null);
    setConflict(false);
    setAuditGap(false);
    const r = await fn();
    setBusy(null);

    if (isApiFailure(r)) {
      if (r.status === 401 || r.status === 403) {
        setDenied(true);
        return;
      }
      if (r.code === "version_conflict") {
        setConflict(true);
        return;
      }
      setActionError(withReference(r));
      return;
    }
    setView(r.value.availability);
    setSaved(savedMessage);
    // The change landed; its audit row did not. Said plainly, because
    // "Saved" and "Saved but unrecorded" are different facts and OPS-015
    // requires the second one to be audited.
    if (r.value.auditRecorded === false) setAuditGap(true);
  }

  if (denied) {
    return <PermissionDeniedState action={{ label: "Try again", onClick: () => { setDenied(false); setGeneration((g) => g + 1); } }} />;
  }
  if (loadError) {
    return (
      <ErrorState
        title="Couranr could not load availability"
        body={loadError}
        action={{ label: "Try again", onClick: () => setGeneration((g) => g + 1) }}
      />
    );
  }
  if (view === null) {
    return (
      <LoadingState label="Loading availability controls">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  return (
    <Stack gap={6}>
      {/* ───────────────────────────────── governed, and not editable here ── */}
      <Card>
        <CardHeader
          title="Operating hours and cutoff"
          description="Decided in the Couranr Decision Registry. These are shown here so an operator can see what is in force; they are not editable on this screen, and nothing on this screen can override them."
        />
        <Grid columns={3}>
          <GovernedFact
            decision="HRS-001"
            label="Operating days"
            value={OPERATING_DAYS_COPY}
          />
          <GovernedFact
            decision="HRS-001"
            label="Standard window"
            value={OPERATING_WINDOW_COPY}
            note="Start inclusive, end exclusive."
          />
          <GovernedFact
            decision="HRS-001"
            label="Same-day request cutoff"
            value={SAME_DAY_CUTOFF_COPY}
            note="After the cutoff, delivery is normally the next business day; Friday after the cutoff is normally Monday."
          />
          <GovernedFact decision="HRS-002" label="Operating timezone" value={COURANR_TIMEZONE} />
          <GovernedFact
            decision="OVN-001"
            label="Overnight window"
            value={OVERNIGHT_WINDOW_COPY}
            note={`Request-only, ${dollars(SERVICE_LEVEL_CENTS.overnight)}, never stacked with rush.`}
          />
        </Grid>
        <Divider />
        <Text size="sm" muted>
          To change any value above, change the decision record first. A hours or
          cutoff value typed into an Operations screen would be a second
          authority, and there is only one.
        </Text>
      </Card>

      {/* ──────────────────────────────────────────── the provisioning gate ── */}
      {view.provisioned ? null : (
        <Alert tone="warning" title="Availability controls are not provisioned yet">
          Migration <code>20260917210000_couranr_operations_settings</code> creates
          the tables that hold market modes and operational switches, and it has
          not been applied. Everything below reads at its launch default and
          cannot be changed until it is applied. Couranr is showing you this
          rather than an empty form, because an empty form would look like
          nothing is configured.
        </Alert>
      )}

      {view.unavailable.length > 0 ? (
        <Alert tone="danger" title="Couranr could not read part of this page">
          These sections failed to load and are not shown as empty:{" "}
          {view.unavailable.join(", ")}. Reload, and contact Couranr Support if it
          persists.
        </Alert>
      ) : null}

      {conflict ? (
        <ConflictState action={{ label: "Reload", onClick: () => setGeneration((g) => g + 1) }} />
      ) : null}

      {actionError ? (
        <Alert tone="danger" title="That change did not go through">
          {actionError}
        </Alert>
      ) : null}

      {auditGap ? (
        <Alert tone="warning" title="The change was applied but not recorded">
          Couranr could not write the audit entry for that change. The change is
          live. Tell Couranr Support before making another one.
        </Alert>
      ) : null}

      {saved && !conflict && !actionError ? (
        <Alert tone="success" title="Published">
          {saved}
        </Alert>
      ) : null}

      {/* ───────────────────────────────────────────────── market controls ── */}
      <Card>
        <CardHeader
          title="Markets"
          description="The operational mode of each market, whether it is accepting work at all, and the days it is closed."
        />
        <Stack gap={6}>
          {view.markets.length === 0 ? (
            <Text muted>Couranr has no market configured.</Text>
          ) : (
            view.markets.map((m) => {
              const editable = view.provisioned && m.version >= 1;
              return (
                <Stack gap={3} key={m.marketKey}>
                  <Cluster gap={3}>
                    <Text strong>{m.marketKey}</Text>
                    <Badge tone={STATE_TONES[m.availabilityState]}>
                      {STATE_LABELS[m.availabilityState]}
                    </Badge>
                    <Badge tone={m.active ? "success" : "danger"}>
                      {m.active ? "Accepting work" : "Not accepting work"}
                    </Badge>
                  </Cluster>

                  <Grid columns={2}>
                    <Field
                      label="Availability mode"
                      hint={
                        editable
                          ? "Publishing a mode changes what the planner offers. It never changes hours or the cutoff."
                          : "Not editable until the availability tables are applied."
                      }
                    >
                      {(p) => (
                        <Select
                          {...p}
                          value={m.availabilityState}
                          disabled={!editable || busy !== null}
                          onChange={(e) =>
                            void run(
                              { kind: "market", key: m.marketKey },
                              () =>
                                setMarketAvailability({
                                  marketKey: m.marketKey,
                                  availabilityState: e.target.value as AvailabilityStateId,
                                  expectedVersion: m.version,
                                }),
                              `${m.marketKey} is now ${STATE_LABELS[
                                e.target.value as AvailabilityStateId
                              ].toLowerCase()}.`
                            )
                          }
                        >
                          {(Object.keys(STATE_LABELS) as AvailabilityStateId[]).map((s) => (
                            <option key={s} value={s}>
                              {STATE_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>

                    <Stack gap={2}>
                      <Text size="sm" muted>
                        Market availability
                      </Text>
                      <Button
                        variant={m.active ? "secondary" : "primary"}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            { kind: "market", key: `${m.marketKey}:active` },
                            () => setMarketActive({ marketKey: m.marketKey, active: !m.active }),
                            m.active
                              ? `${m.marketKey} is no longer accepting work.`
                              : `${m.marketKey} is accepting work again.`
                          )
                        }
                      >
                        {m.active ? "Stop accepting work" : "Start accepting work"}
                      </Button>
                      <Text size="sm" muted>
                        Concurrent delivery limit:{" "}
                        {m.maxConcurrentDeliveries === null
                          ? "not set"
                          : m.maxConcurrentDeliveries}
                      </Text>
                    </Stack>
                  </Grid>

                  <Stack gap={2}>
                    <Text size="sm" strong>
                      Closures
                    </Text>
                    {m.closures.length === 0 ? (
                      <Text size="sm" muted>
                        No closure is recorded for this market. Planning treats every
                        operating day as open.
                      </Text>
                    ) : (
                      <TableScroll>
                        <Table caption={`Recorded closures for ${m.marketKey}`}>
                          <thead>
                            <tr>
                              <th scope="col">Date</th>
                              <th scope="col">Reason</th>
                              <th scope="col">Status</th>
                              <th scope="col">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.closures.map((c) => (
                              <tr key={c.id}>
                                <td>{c.localDate}</td>
                                <td>{c.reason}</td>
                                <td>
                                  <Badge tone={c.active ? "danger" : "neutral"}>
                                    {c.active ? "Closed" : "Lifted"}
                                  </Badge>
                                </td>
                                <td>
                                  {c.active ? (
                                    <Button
                                      size="sm"
                                      disabled={busy !== null}
                                      onClick={() =>
                                        void run(
                                          { kind: "closure", key: c.id },
                                          () => liftOperatingClosure({ closureId: c.id }),
                                          `${m.marketKey} is open again on ${c.localDate}.`
                                        )
                                      }
                                    >
                                      Lift closure
                                    </Button>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </TableScroll>
                    )}

                    <ClosureForm
                      marketKey={m.marketKey}
                      busy={busy !== null}
                      onSubmit={(localDate, reason) =>
                        void run(
                          { kind: "closure", key: `${m.marketKey}:new` },
                          () =>
                            openOperatingClosure({ marketKey: m.marketKey, localDate, reason }),
                          `${m.marketKey} is closed on ${localDate}.`
                        )
                      }
                    />
                  </Stack>
                  <Divider />
                </Stack>
              );
            })
          )}
        </Stack>
      </Card>

      {/* ─────────────────────────────────────────────── FLG-001 switches ── */}
      <Card>
        <CardHeader
          title="Operational switches"
          description="The four capabilities FLG-001 requires Couranr Operations to be able to switch independently. All four are off at launch."
        />
        <Stack gap={6}>
          {view.flags.map((f) => {
            const copy = FLAG_COPY[f.key];
            const editable = view.provisioned && f.version >= 1;
            return (
              <Stack gap={2} key={f.key}>
                <Cluster gap={3}>
                  <Text strong>{copy.label}</Text>
                  <Badge tone={f.enabled ? (copy.onIsSafe ? "success" : "warning") : "neutral"}>
                    {f.enabled ? "On" : "Off"}
                  </Badge>
                  <Text size="sm" muted>
                    {copy.authority}
                  </Text>
                </Cluster>
                <Text size="sm" muted>
                  {copy.body}
                </Text>
                <Cluster gap={2}>
                  <Button
                    variant={f.enabled ? "secondary" : "primary"}
                    disabled={!editable || busy !== null}
                    onClick={() =>
                      void run(
                        { kind: "flag", key: f.key },
                        () =>
                          setOperationalFlag({
                            flagKey: f.key,
                            enabled: !f.enabled,
                            expectedVersion: f.version,
                          }),
                        `${copy.label} is now ${f.enabled ? "off" : "on"}.`
                      )
                    }
                  >
                    {f.enabled ? `Turn ${copy.label.toLowerCase()} off` : `Turn ${copy.label.toLowerCase()} on`}
                  </Button>
                  {editable ? null : (
                    <Text size="sm" muted>
                      Not editable until the availability tables are applied.
                    </Text>
                  )}
                </Cluster>
                <Divider />
              </Stack>
            );
          })}
        </Stack>
      </Card>
    </Stack>
  );
}

function GovernedFact({
  decision,
  label,
  value,
  note,
}: {
  decision: string;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <Stack gap={2}>
      <Text size="sm" muted>
        {label}
      </Text>
      <Text strong>{value}</Text>
      <Text size="sm" muted>
        {decision}
        {note ? ` — ${note}` : ""}
      </Text>
    </Stack>
  );
}
