"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Divider,
  Heading,
  Stack,
  Text,
  VisuallyHidden,
} from "@/components/couranr/primitives";
import { Field, Select, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, ErrorState } from "@/components/couranr/states";
import { CouranrLogo } from "@/components/brand/CouranrLogo";
import type { CustomerTopic } from "@/lib/couranr/conversations/states";
import { fetchHelp, newIdempotencyKey, sendHelpMessage, type HelpView } from "./client";

/**
 * PUB-007 — Delivery Help.
 *
 * REQUIRED STATES, from the registry: "Open; waiting on customer; waiting on
 * Couranr; resolved; after-hours; urgent safety escalation."
 *
 * WHAT THIS PAGE MAY NOT DO:
 *
 *   * "No public support phone at MVP." There is no number anywhere on this
 *     page, and the API returns `supportPhone: null` so none can be introduced
 *     by reading the payload.
 *   * "State the normal 15-minute response target during operating hours, not a
 *     guarantee." The copy says "normally replies within", never "will reply"
 *     or "guaranteed".
 *   * TRM-001: no 24/7 claim, no founder voice. It is Couranr that replies.
 *
 * AFTER-HOURS IS NOT RENDERED, deliberately rather than by omission. HRS-002 is
 * `unresolved` — "A named IANA timezone is recorded before any cutoff logic
 * ships" — so the server reports `operatingHoursApplied: false` and this page
 * states the window without claiming the current moment is inside or outside
 * it. Rendering "we are closed" from a guessed timezone would be worse than
 * saying nothing, because a customer who believes nobody is reading will stop
 * writing.
 */

const TOPIC_LABELS: Record<CustomerTopic, string> = {
  availability: "I will not be available",
  access: "Access or entry instructions",
  address_concern: "Something about the address",
  handoff_concern: "How the handoff should work",
  unrecognized_delivery: "I did not expect this delivery",
  delivery_problem: "There is a problem with the delivery",
  other: "Something else",
};

/**
 * The fragments UI_SCREEN_REGISTRY.md gives CUS-001 and CUS-003 —
 * `/help/[token]#address-change` and `#recipient-unavailable`. Opening the page
 * at one preselects its topic, which is what makes them screens in the
 * registry's sense without being separate routes or separate write paths.
 */
const FRAGMENT_TOPICS: Record<string, CustomerTopic> = {
  "address-change": "address_concern",
  "recipient-unavailable": "availability",
  "delivery-problem": "delivery_problem",
};

const REFUSAL = "This help link is not available.";

type Phase =
  | { phase: "loading" }
  | { phase: "refused" }
  | { phase: "failed" }
  | { phase: "ready"; view: HelpView };

export function DeliveryHelpPage({ token }: { token: string }) {
  const [state, setState] = React.useState<Phase>({ phase: "loading" });

  const [topic, setTopic] = React.useState<CustomerTopic>("other");
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [justSent, setJustSent] = React.useState(false);

  /**
   * One key per composed message, held until that message is accepted. A retry
   * reuses it, so a double-tap on a flaky connection posts once rather than
   * twice — the server resolves the duplicate to the original.
   */
  const idempotencyKey = React.useRef<string>("");
  if (idempotencyKey.current === "") idempotencyKey.current = newIdempotencyKey();

  const load = React.useCallback(async () => {
    setState({ phase: "loading" });
    const result = await fetchHelp(token);
    if ("failed" in result) setState({ phase: "failed" });
    else if (!result.resolved) setState({ phase: "refused" });
    else setState({ phase: "ready", view: result.view });
  }, [token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Preselect from the fragment, so CUS-001 and CUS-003 open on their topic.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const preset = FRAGMENT_TOPICS[window.location.hash.replace(/^#/, "")];
    if (preset) setTopic(preset);
  }, []);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (sending || body.trim().length === 0) return;
    setSending(true);
    setSendError(null);

    const outcome = await sendHelpMessage({
      token,
      body,
      topic,
      idempotencyKey: idempotencyKey.current,
    });

    setSending(false);
    // `tsconfig` sets "strict": false, so `!outcome.sent` does not narrow this
    // union — the same reason every command module in this repo ships an
    // explicit `is*Failure` predicate rather than relying on `.ok`.
    if (outcome.sent === false) {
      setSendError(outcome.reason);
      return;
    }

    // Accepted: retire this key so the next message is a new one.
    idempotencyKey.current = newIdempotencyKey();
    setBody("");
    setJustSent(true);
    await load();
  }

  if (state.phase === "loading") {
    return (
      <Stack gap={6}>
        <CouranrLogo />
        <VisuallyHidden>Loading your delivery help.</VisuallyHidden>
        <CardSkeleton />
      </Stack>
    );
  }

  if (state.phase === "refused") {
    // ONE SENTENCE for expired, revoked, unknown and malformed. The server
    // already collapsed them; a per-reason message here would put the
    // distinction back. No retry, because retrying resolves nothing.
    return (
      <Stack gap={6}>
        <CouranrLogo />
        <Alert tone="warning" title="Delivery Help">
          <Text>{REFUSAL}</Text>
          <Text>
            If you are expecting a delivery, the business that arranged it can send you a new link.
          </Text>
        </Alert>
      </Stack>
    );
  }

  if (state.phase === "failed") {
    // Distinct from a refusal: we could not find out, so a retry is offered.
    return (
      <Stack gap={6}>
        <CouranrLogo />
        <ErrorState
          title="We could not load this page"
          body="Check your connection and try again."
          action={{ label: "Try again", onClick: () => void load() }}
        />
      </Stack>
    );
  }

  const { view } = state;
  const waitingOnCouranr = view.messages.length > 0;

  return (
    <Stack gap={6}>
      <CouranrLogo />

      <Stack gap={2}>
        <Heading level={1}>Delivery Help</Heading>
        <Text muted>
          Tell Couranr what you need and we will take it from here. This link is for one delivery.
        </Text>
      </Stack>

      <Card>
        <CardHeader
          title="How quickly we reply"
          description={
            /* "Normally" and "target", never "guaranteed" — PUB-007's mandatory
               correction, and TRM-001's no-24/7 rule. */
            `Couranr normally replies to messages within ${view.supportTargetMinutes} minutes during operating hours. Operating hours are Monday to Friday, 6:00 AM to 6:00 PM.`
          }
        />
        <Text muted>
          Couranr does not offer phone support. Everything is handled here so it stays attached to
          your delivery.
        </Text>
      </Card>

      <Divider />

      <Stack gap={3}>
        <Heading level={2}>Your messages</Heading>

        {view.messages.length === 0 ? (
          <Text muted>
            You have not sent anything yet. Choose what this is about and tell us what is happening.
          </Text>
        ) : (
          <Stack gap={3}>
            {/* Derived from what the customer can actually see. The server does
                not send a "waiting on" for this surface, and inventing one from
                a guessed timezone is exactly what HRS-002 forbids. */}
            <Badge tone={waitingOnCouranr ? "info" : "neutral"}>
              {waitingOnCouranr ? "Waiting on Couranr" : "Open"}
            </Badge>

            {view.messages.map((m) => (
              <Card key={m.id}>
                <Stack gap={2}>
                  <Text muted size="sm">
                    {(m.topic ? TOPIC_LABELS[m.topic] : null) ?? "Update"} ·{" "}
                    {new Date(m.createdAt).toLocaleString()}
                  </Text>
                  <Text>{m.body}</Text>
                </Stack>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>

      <Divider />

      <form onSubmit={onSend}>
        <Stack gap={3}>
          <Heading level={2}>Send a message</Heading>

          <Field label="What is this about?" required>
            {(p) => (
              <Select
                {...p}
                value={topic}
                onChange={(e) => setTopic(e.target.value as CustomerTopic)}
              >
                {view.topics.map((t) => (
                  <option key={t} value={t}>
                    {TOPIC_LABELS[t] ?? t}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Tell us what is happening" required>
            {(p) => (
              <Textarea
                {...p}
                value={body}
                maxLength={4000}
                rows={5}
                onChange={(e) => {
                  setBody(e.target.value);
                  setJustSent(false);
                }}
                placeholder="For example: I will not be home until after 6pm."
              />
            )}
          </Field>

          {/* Said plainly rather than discovered. A customer who expects a
              message to move their delivery and finds it did not is worse off
              than one who was told up front. */}
          <Text muted size="sm">
            Sending a message does not change your delivery on its own. Couranr will read it and
            confirm anything that needs to change.
          </Text>

          {sendError ? (
            <Alert tone="danger" title="Not sent">
              {sendError}
            </Alert>
          ) : null}
          {justSent ? (
            <Alert tone="success" title="Sent">
              Couranr has your message.
            </Alert>
          ) : null}

          <Button type="submit" disabled={sending || body.trim().length === 0}>
            {sending ? "Sending…" : "Send to Couranr"}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
