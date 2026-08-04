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
import { Field, Select, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/couranr/states";
import {
  isApiFailure,
  markRead,
  newMessageKey,
  readThread,
  sendMessage,
  type ThreadView,
} from "./client";
import { SUPPORT_TARGET_MINUTES, type Visibility } from "@/lib/couranr/conversations/states";

/**
 * One conversation thread, shared by MER-012, DRV-008 and OPS-005.
 *
 * WHAT THIS COMPONENT CANNOT RENDER, and why that is structural rather than
 * careful: the server projection carries no `visibility` and no `authorship`
 * field. An internal note or an AI draft is not filtered out here — it never
 * arrives. There is no property on `ThreadMessage` that could betray one.
 *
 * The composer's visibility control appears ONLY for an Operations viewer,
 * because `couranr_internal` is the only value a non-Operations participant
 * could address and must not. The server refuses it regardless; hiding the
 * control means a merchant is never offered a choice that would be rejected.
 *
 * TRM-001: no phone number, no 24/7 claim, no founder voice. The response
 * target is stated as what Couranr normally does, never as a guarantee.
 */

const VISIBILITY_LABELS: Partial<Record<Visibility, string>> = {
  participants: "Everyone in this thread",
  couranr_internal: "Couranr only — internal note",
  driver_and_couranr: "Driver and Couranr",
  merchant_and_couranr: "Merchant and Couranr",
};

/** What each viewer may address. Mirrors the SQL kind × visibility matrix. */
function addressableBy(viewerKind: string, conversationKind: string): Visibility[] {
  if (viewerKind !== "operations") return ["participants"];
  if (conversationKind === "delivery_chat") {
    return ["participants", "couranr_internal", "driver_and_couranr", "merchant_and_couranr"];
  }
  if (conversationKind === "merchant_support") {
    return ["participants", "couranr_internal", "merchant_and_couranr"];
  }
  // delivery_help admits only these two.
  return ["participants", "couranr_internal"];
}

const DUE_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  on_time: "neutral",
  due_soon: "warning",
  overdue: "danger",
};

export function ConversationThread({
  conversationId,
  onChanged,
}: {
  conversationId: string;
  onChanged?: () => void;
}) {
  const [state, setState] = React.useState<
    { phase: "loading" } | { phase: "failed"; error: string } | { phase: "ready"; view: ThreadView }
  >({ phase: "loading" });

  const [body, setBody] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>("participants");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);

  const messageKey = React.useRef<string>("");
  if (messageKey.current === "") messageKey.current = newMessageKey();

  const load = React.useCallback(async () => {
    setState({ phase: "loading" });
    const r = await readThread(conversationId);
    if (isApiFailure(r)) {
      setState({ phase: "failed", error: r.error });
      return;
    }
    setState({ phase: "ready", view: r.value });

    // Marking read is a side effect of having seen the thread, and its failure
    // must not break rendering it. "Unread" being briefly stale is a smaller
    // problem than an unreadable thread.
    void markRead(conversationId);
  }, [conversationId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (sending || body.trim().length === 0) return;
    setSending(true);
    setSendError(null);

    const r = await sendMessage({
      conversationId,
      body,
      idempotencyKey: messageKey.current,
      visibility,
    });

    setSending(false);
    if (isApiFailure(r)) {
      setSendError(r.error);
      return;
    }

    messageKey.current = newMessageKey();
    setBody("");
    await load();
    onChanged?.();
  }

  if (state.phase === "loading") {
    return (
      <>
        <VisuallyHidden>Loading this conversation.</VisuallyHidden>
        <CardSkeleton />
      </>
    );
  }

  if (state.phase === "failed") {
    return (
      <ErrorState
        title="We could not open this conversation"
        body={state.error}
        action={{ label: "Try again", onClick: () => void load() }}
      />
    );
  }

  const { view } = state;
  const options = addressableBy(view.viewerKind, view.conversation.kind);
  const isOperations = view.viewerKind === "operations";

  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <Heading level={2}>Conversation</Heading>
        <Stack gap={2}>
          <Badge tone={DUE_TONE[view.conversation.dueState] ?? "neutral"}>
            {view.conversation.dueState === "overdue"
              ? "Overdue"
              : view.conversation.dueState === "due_soon"
                ? "Due soon"
                : "On time"}
          </Badge>
          {view.conversation.waitingOn ? (
            <Text muted size="sm">
              Waiting on {view.conversation.waitingOn === "couranr" ? "Couranr" : view.conversation.waitingOn}
            </Text>
          ) : null}
        </Stack>
        <Text muted size="sm">
          Couranr normally responds within {SUPPORT_TARGET_MINUTES} minutes during operating hours.
        </Text>
      </Stack>

      <Divider />

      {view.messages.length === 0 ? (
        <EmptyState
          title="No messages yet"
          body="Anything sent here stays attached to this delivery."
        />
      ) : (
        <Stack gap={3}>
          {view.messages.map((m) => (
            <Card key={m.id}>
              <Stack gap={2}>
                <Text muted size="sm">
                  {m.authoredByPerson ? "Message" : "Automatic update"} ·{" "}
                  {new Date(m.createdAt).toLocaleString()}
                </Text>
                <Text>{m.body}</Text>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

      <Divider />

      <form onSubmit={onSend}>
        <Stack gap={3}>
          <Heading level={3}>Reply</Heading>

          {/* Operations only. `couranr_internal` is the one value a merchant or
              driver could name and must not, and the server refuses it anyway —
              hiding the control means nobody is offered a rejected choice. */}
          {isOperations ? (
            <Field label="Who can see this?" required>
              {(p) => (
                <Select
                  {...p}
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as Visibility)}
                >
                  {options.map((v) => (
                    <option key={v} value={v}>
                      {VISIBILITY_LABELS[v] ?? v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field label="Your message" required>
            {(p) => (
              <Textarea
                {...p}
                value={body}
                rows={4}
                maxLength={4000}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </Field>

          {/* Said plainly. MER-012's mandatory correction: "Messages never
              directly mutate address, price, cancellation, refund, return,
              proof, or state." */}
          <Text muted size="sm">
            Sending a message does not change the delivery on its own. Couranr confirms anything
            that needs to change.
          </Text>

          {sendError ? (
            <Alert tone="danger" title="Not sent">
              {sendError}
            </Alert>
          ) : null}

          <Button type="submit" disabled={sending || body.trim().length === 0}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
