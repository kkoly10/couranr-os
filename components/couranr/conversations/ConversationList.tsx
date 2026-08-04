"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  Heading,
  Stack,
  Text,
  VisuallyHidden,
} from "@/components/couranr/primitives";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/couranr/states";
import { ConversationThread } from "./ConversationThread";
import { isApiFailure, listConversations, type ConversationSummary } from "./client";

/**
 * MER-012 and DRV-008 — the merchant's and driver's list of threads.
 *
 * REQUIRED STATES the registry names for these two screens: "Unread; response
 * pending; AI answered; human review; after-hours; closed" (MER-012) and
 * "Unread; driving suppressed; AI draft; human support; closed" (DRV-008).
 *
 * Three of those cannot be rendered yet and are NOT faked:
 *   * "after-hours" needs HRS-002, which is unresolved. The server reports
 *     `operatingHoursApplied: false` and no surface claims otherwise.
 *   * "AI answered" / "AI draft" need P8-003's assistant, which is not built.
 *     An AI draft is excluded from every participant read by design, so this
 *     screen could not show one even if drafts existed.
 *   * "driving suppressed" is P8-003 alert suppression, also not built.
 *
 * What IS rendered: unread, waiting-on, due state, and closed. Showing a state
 * this slice cannot compute would be worse than omitting it — a merchant who
 * believes "after-hours" was assessed will draw the wrong conclusion from it.
 */

const DUE_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  on_time: "neutral",
  due_soon: "warning",
  overdue: "danger",
};

const KIND_LABEL: Record<string, string> = {
  merchant_support: "Couranr Support",
  delivery_chat: "Delivery chat",
  delivery_help: "Delivery Help",
};

export function ConversationList({ emptyBody }: { emptyBody: string }) {
  const [state, setState] = React.useState<
    | { phase: "loading" }
    | { phase: "failed"; error: string }
    | { phase: "ready"; rows: ConversationSummary[] }
  >({ phase: "loading" });

  const [openId, setOpenId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await listConversations();
    if (isApiFailure(r)) {
      setState({ phase: "failed", error: r.error });
      return;
    }
    setState({ phase: "ready", rows: r.value.conversations });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === "loading") {
    return (
      <>
        <VisuallyHidden>Loading your conversations.</VisuallyHidden>
        <CardSkeleton />
      </>
    );
  }

  if (state.phase === "failed") {
    return (
      <ErrorState
        title="We could not load your messages"
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
          Back to all messages
        </Button>
        <ConversationThread conversationId={openId} onChanged={() => void load()} />
      </Stack>
    );
  }

  if (state.rows.length === 0) {
    return <EmptyState title="No messages yet" body={emptyBody} />;
  }

  return (
    <Stack gap={3}>
      {state.rows.map((c) => (
        <Card key={c.id}>
          <Stack gap={2}>
            <Stack gap={2}>
              <Heading level={3}>{KIND_LABEL[c.kind] ?? "Conversation"}</Heading>
              <Stack gap={2}>
                {c.unreadCount > 0 ? <Badge tone="info">Unread</Badge> : null}
                {c.dueState !== "on_time" ? (
                  <Badge tone={DUE_TONE[c.dueState] ?? "neutral"}>
                    {c.dueState === "overdue" ? "Overdue" : "Due soon"}
                  </Badge>
                ) : null}
                {c.status === "closed" ? <Badge tone="neutral">Closed</Badge> : null}
                {c.status === "escalated" ? <Badge tone="warning">Escalated</Badge> : null}
              </Stack>
            </Stack>

            {c.waitingOn ? (
              <Text muted size="sm">
                Waiting on {c.waitingOn === "couranr" ? "Couranr" : c.waitingOn}
              </Text>
            ) : null}

            <Text muted size="sm">
              Updated {new Date(c.updatedAt).toLocaleString()}
            </Text>

            <Button type="button" onClick={() => setOpenId(c.id)}>
              Open
            </Button>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
