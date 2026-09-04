"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Heading,
  Stack,
  Text,
  VisuallyHidden,
} from "@/components/couranr/primitives";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/couranr/states";
import { ConversationThread } from "./ConversationThread";
import { isApiFailure, loadOperationsInbox, type InboxView } from "./client";

/**
 * OPS-005 — the Couranr Operations Inbox.
 *
 * Its purpose, verbatim from UI_SCREEN_REGISTRY.md: "Unify merchant, driver,
 * and customer-help conversations with delivery context and priority." That
 * sentence is why the Inbox is a PROJECTION over the three conversation kinds
 * rather than a fourth kind of its own.
 *
 * ORDERING IS THE PRODUCT, and it is computed server-side: overdue first, then
 * due soon, then by urgency, then oldest deadline. An inbox sorted by recency
 * would bury the thread that has waited longest, which is the only one the
 * 15-minute target is actually about.
 *
 * MANDATORY CORRECTION, verbatim: "Internal notes and AI drafts must be
 * excluded from participant queries, exports, realtime, and notifications."
 * Operations is the one viewer that MAY read an internal note — and even here
 * AI drafts are excluded, because a draft is unsent. Both rules live in the
 * database: no role holds SELECT on the message table. D2 gives this surface an
 * explicit admin-verified Operations reader rather than inventing a second live
 * participant row for an admin who may also be the merchant owner.
 *
 * REQUIRED STATES: "Unread; urgent; active delivery; waiting on party; AI
 * draft; escalated; closed." Two are not rendered and are not faked — "AI
 * draft" needs the assistant, which is not built and whose drafts are excluded
 * from every thread read by design; "active delivery" needs the delivery join,
 * which this slice does not make.
 */

const DUE_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  on_time: "neutral",
  due_soon: "warning",
  overdue: "danger",
};

const KIND_LABEL: Record<string, string> = {
  merchant_support: "Merchant support",
  delivery_chat: "Merchant–driver",
  delivery_help: "Customer help",
};

export function OperationsInbox() {
  const [state, setState] = React.useState<
    { phase: "loading" } | { phase: "failed"; error: string } | { phase: "ready"; view: InboxView }
  >({ phase: "loading" });

  const [openId, setOpenId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await loadOperationsInbox();
    if (isApiFailure(r)) {
      setState({ phase: "failed", error: r.error });
      return;
    }
    setState({ phase: "ready", view: r.value });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === "loading") {
    return (
      <>
        <VisuallyHidden>Loading the Operations inbox.</VisuallyHidden>
        <CardSkeleton />
      </>
    );
  }

  if (state.phase === "failed") {
    return (
      <ErrorState
        title="We could not load the inbox"
        body={state.error}
        action={{ label: "Try again", onClick: () => void load() }}
      />
    );
  }

  if (openId) {
    return (
      <Stack gap={4}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setOpenId(null);
            void load();
          }}
        >
          Back to the inbox
        </Button>
        <ConversationThread
          conversationId={openId}
          context="operations"
          onChanged={() => void load()}
        />
      </Stack>
    );
  }

  const { view } = state;

  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <Stack gap={2}>
          {view.counts.overdue > 0 ? (
            <Badge tone="danger">{view.counts.overdue} overdue</Badge>
          ) : null}
          {view.counts.dueSoon > 0 ? (
            <Badge tone="warning">{view.counts.dueSoon} due soon</Badge>
          ) : null}
          <Badge tone="neutral">{view.counts.total} open</Badge>
        </Stack>
        <Text muted size="sm">
          Couranr normally responds within {view.supportTargetMinutes} minutes during operating
          hours.
        </Text>
      </Stack>

      {/* Kept as a fail-LOUD notice rather than deleted. HRS-002 is decided, so
          this should never render; if a future change ever reports false again,
          Operations is told the marks are elapsed-time only instead of silently
          reading an out-of-hours thread as overdue. */}
      {!view.operatingHoursApplied ? (
        <Alert tone="info" title="Operating hours are not applied to these marks">
          Due and overdue marks count elapsed time only, so an out-of-hours thread will read as
          overdue sooner than the policy intends.
        </Alert>
      ) : null}

      <Divider />

      {view.conversations.length === 0 ? (
        <EmptyState title="Nothing waiting" body="Every conversation has been handled." />
      ) : (
        <Stack gap={3}>
          {view.conversations.map((c) => (
            <Card key={c.id}>
              <Stack gap={2}>
                <Stack gap={2}>
                  <Heading level={3}>{KIND_LABEL[c.kind] ?? "Conversation"}</Heading>
                  <Stack gap={2}>
                    {c.dueState !== "on_time" ? (
                      <Badge tone={DUE_TONE[c.dueState] ?? "neutral"}>
                        {c.dueState === "overdue" ? "Overdue" : "Due soon"}
                      </Badge>
                    ) : null}
                    {c.urgency === "safety" ? <Badge tone="danger">Safety</Badge> : null}
                    {c.urgency === "urgent" ? <Badge tone="warning">Urgent</Badge> : null}
                    {c.status === "escalated" ? <Badge tone="warning">Escalated</Badge> : null}
                  </Stack>
                </Stack>

                {c.waitingOn ? (
                  <Text muted size="sm">
                    Waiting on {c.waitingOn === "couranr" ? "Couranr" : c.waitingOn}
                  </Text>
                ) : null}

                {c.responseDueAt ? (
                  <Text muted size="sm">
                    Response due {new Date(c.responseDueAt).toLocaleString()}
                  </Text>
                ) : null}

                <Button type="button" onClick={() => setOpenId(c.id)}>
                  Open
                </Button>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
