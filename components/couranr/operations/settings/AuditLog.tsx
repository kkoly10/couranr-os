"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Table,
  TableScroll,
  Text,
} from "@/components/couranr/primitives";
import { Field, Select } from "@/components/couranr/forms";
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { fetchAuditLog, type AuditLog as AuditLogView } from "./client";

/**
 * OPS-020 — the activity and audit log.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS COMPONENT HAS NO WRITE PATH, AND THAT IS THE REQUIREMENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OPS-020's constraint is "Append-only; no edit/delete." There is therefore no
 * edit control, no delete control, no row menu, no inline field and no
 * selection checkbox anywhere below — not disabled ones, NONE. A disabled
 * delete button still tells an operator that deleting is a thing Couranr can
 * do, and the next person to touch the file removes the `disabled`.
 *
 * Every control that DOES exist is a read: two filters, an export of what is
 * already on screen, and a link into the delivery an entry is about. Those are
 * OPS-020's own declared actions — "Filter; inspect event; export permitted
 * audit; link to entity" — and none of them writes anything.
 *
 * The same guarantee is repeated at two lower layers so it does not depend on
 * this file: `./client` exports only `fetchAuditLog`, the route exports only
 * `GET`, and the eleven event tables grant service_role SELECT and INSERT with
 * no UPDATE and no DELETE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS NOT ON THIS SCREEN, BY CONSTRUCTION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No secret, token, digest, proof URL, gate code, phone number or full
 * address. The redaction runs server-side in
 * `lib/couranr/operations/settings.ts` in three layers (column allow-list,
 * key-name denial, value-shape scrubbing) and this component renders whatever
 * survives. It does NOT re-redact: a second, weaker copy of the rule here
 * would be the thing people maintained instead of the real one.
 *
 * Actor and subject identifiers arrive as eight-character fingerprints, never
 * whole. An auditor needs to tell two actors apart, not to hold a join key.
 * The one exception is `entityHref`, a typed relative path into
 * `/operations/deliveries/[id]` — see its declaration for why a delivery id is
 * not one of the classes OPS-020 forbids.
 */

const SOURCE_LABELS: Record<string, string> = {
  delivery_request_events: "Delivery requests",
  delivery_events: "Deliveries",
  delivery_incident_events: "Incidents",
  assignment_events: "Dispatch assignments",
  payment_events: "Payment events",
  conversation_events: "Conversations",
  activation_events: "Workspace activation",
  customer_problem_report_events: "Customer problem reports",
  intake_fact_events: "Smart intake facts",
  team_events: "Team membership",
  operations_setting_events: "Operations settings",
};

const SOURCE_IDS = Object.keys(SOURCE_LABELS);

function label(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * OPS-020's "export permitted audit" action.
 *
 * PERMITTED is the operative word, and it is satisfied structurally: the export
 * serializes the ENTRIES ALREADY ON SCREEN, which are what the server-side
 * redaction let through. It re-reads nothing, requests nothing, and has no
 * access to anything the table does not already display — so an export can
 * never carry a field the screen would have refused to show.
 *
 * CSV, quoted per RFC 4180: every field is wrapped and every embedded quote is
 * doubled, so a value carrying a comma, a quote or a newline cannot shift the
 * column layout. A spreadsheet that silently mis-parses an audit export is
 * worse than no export.
 */
function auditCsv(entries: AuditLogView["entries"]): string {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = [
    "when",
    "source",
    "actor_kind",
    "actor",
    "event",
    "from_state",
    "to_state",
    "subject",
    "severity",
    "detail",
  ];
  const rows = entries.map((e) =>
    [
      e.createdAt,
      label(e.source),
      e.actorKind,
      e.actorFingerprint,
      e.command,
      e.fromState,
      e.toState,
      e.subject,
      e.severity,
      typeof e.metadata === "object" && e.metadata !== null
        ? JSON.stringify(e.metadata)
        : String(e.metadata ?? ""),
    ].map(cell)
  );
  return [header.map(cell), ...rows].map((r) => r.join(",")).join("\r\n");
}

/** A compact, unambiguous rendering of a redacted jsonb payload. */
function MetadataCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <Text size="sm" muted>—</Text>;
  if (typeof value !== "object") return <Text size="sm">{String(value)}</Text>;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <Text size="sm" muted>—</Text>;

  return (
    <Stack gap={2}>
      {entries.map(([k, v]) => (
        <Text key={k} size="sm">
          <span className="cr-text--muted">{k}:</span>{" "}
          {v === null || v === undefined
            ? "—"
            : typeof v === "object"
              ? JSON.stringify(v)
              : String(v)}
        </Text>
      ))}
    </Stack>
  );
}

export function AuditLog() {
  const [view, setView] = React.useState<AuditLogView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [denied, setDenied] = React.useState(false);
  const [source, setSource] = React.useState<string>("all");
  const [limit, setLimit] = React.useState<number>(50);
  const [generation, setGeneration] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchAuditLog({ source: source === "all" ? undefined : source, limit });
      if (cancelled) return;
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
      // Nested under `audit` by the route. Named, never read flat.
      setView(r.value.audit);
    })();
    return () => {
      cancelled = true;
    };
  }, [source, limit, generation]);

  if (denied) {
    return (
      <PermissionDeniedState
        action={{
          label: "Try again",
          onClick: () => {
            setDenied(false);
            setGeneration((g) => g + 1);
          },
        }}
      />
    );
  }
  if (loadError) {
    return (
      <ErrorState
        title="Couranr could not load the audit log"
        body={loadError}
        action={{ label: "Try again", onClick: () => setGeneration((g) => g + 1) }}
      />
    );
  }
  if (view === null) {
    return (
      <LoadingState label="Loading the audit log">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }

  const alerts = view.entries.filter((e) => e.severity === "security_alert");

  return (
    <Stack gap={6}>
      {/* OPS-020 "immutable record" — stated once, at the top, always. */}
      <Alert tone="info" title="This record is append-only">
        Couranr cannot edit or delete an audit entry, and neither can anyone using
        this screen. Secrets, tokens, proof links, handoff codes, phone numbers
        and addresses are removed before an entry reaches this page.
      </Alert>

      {/* OPS-020 "security alert". */}
      {alerts.length > 0 ? (
        <Alert tone="warning" title={`${alerts.length} entr${alerts.length === 1 ? "y needs" : "ies need"} attention`}>
          A rejected payment event, a blocked activation, an escalated incident or
          a change to the AI kill switch or request intake is flagged below.
        </Alert>
      ) : null}

      {/* OPS-020 "missing evidence" — a source that errored is NAMED, never
          folded into an empty list. */}
      {view.unavailable.length > 0 ? (
        <Alert tone="danger" title="Part of the record could not be read">
          Couranr could not read {view.unavailable.map(label).join(", ")}. What you
          see below is incomplete. This is not the same as those sources having no
          entries.
        </Alert>
      ) : null}

      {view.notProvisioned.length > 0 ? (
        <Alert tone="warning" title="A source is not provisioned yet">
          {view.notProvisioned.map(label).join(", ")} has no table in this
          environment yet, so it contributes no entries. Migration{" "}
          <code>20260917210000_couranr_operations_settings</code> creates it.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Activity and audit log"
          description="State commands, payment events, activation and team changes, intake decisions and settings changes, newest first."
        />
        <Cluster gap={4}>
          <Field label="Source">
            {(p) => (
              <Select {...p} value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="all">All sources</option>
                {SOURCE_IDS.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Entries">
            {(p) => (
              <Select {...p} value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </Select>
            )}
          </Field>
          <Button
            disabled={view.entries.length === 0}
            onClick={() => {
              /*
               * A read action, and the only control on this screen. It exports
               * exactly what is displayed — nothing is re-fetched, so the export
               * cannot contain a field the redaction refused.
               */
              const blob = new Blob([auditCsv(view.entries)], {
                type: "text/csv;charset=utf-8",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `couranr-audit-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export this view
          </Button>
        </Cluster>
      </Card>

      {view.entries.length === 0 ? (
        <EmptyState
          title="No entries in this view"
          body="Nothing matching this filter has been recorded. Widen the source filter to see the whole record."
        />
      ) : (
        <TableScroll>
          <Table caption="Couranr activity and audit log. Read-only and append-only.">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Source</th>
                <th scope="col">Actor</th>
                <th scope="col">Event</th>
                <th scope="col">Transition</th>
                <th scope="col">Subject</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {view.entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Text size="sm" numeric>
                      {e.createdAt}
                    </Text>
                  </td>
                  <td>
                    <Text size="sm">{label(e.source)}</Text>
                  </td>
                  <td>
                    <Stack gap={2}>
                      <Text size="sm">{e.actorKind ?? "—"}</Text>
                      <Text size="sm" muted numeric>
                        {e.actorFingerprint ?? "—"}
                      </Text>
                    </Stack>
                  </td>
                  <td>
                    <Cluster gap={2}>
                      <Text size="sm">{e.command ?? "—"}</Text>
                      {e.severity === "security_alert" ? (
                        <Badge tone="warning">Needs attention</Badge>
                      ) : null}
                    </Cluster>
                  </td>
                  <td>
                    <Text size="sm">
                      {e.fromState || e.toState
                        ? `${e.fromState ?? "—"} → ${e.toState ?? "—"}`
                        : "—"}
                    </Text>
                  </td>
                  <td>
                    {/* OPS-020 "link to entity". Only where a canonical
                        Operations screen exists for that entity; otherwise the
                        reference is rendered as plain text rather than as a
                        link that 404s. */}
                    {e.entityHref ? (
                      <Link href={e.entityHref}>{e.subject ?? "Open"}</Link>
                    ) : (
                      <Text size="sm" numeric>
                        {e.subject ?? "—"}
                      </Text>
                    )}
                  </td>
                  <td>
                    <MetadataCell value={e.metadata} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}

      {view.truncated ? (
        <Text size="sm" muted>
          At least one source returned the full {view.limit} entries, so older
          entries exist beyond this view. Narrow the source filter or raise the
          entry count to see further back.
        </Text>
      ) : null}
    </Stack>
  );
}
