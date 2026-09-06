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
  VisuallyHidden,
} from "@/components/couranr/primitives";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { PickupCredentialDisplay } from "./PickupCredentialDisplay";
import {
  issueMerchantPickupCode,
  issueMerchantRecipientCode,
  issueOperationsPickupCode,
  issueOperationsRecipientCode,
  issueMerchantReturnCode,
  issueOperationsReturnCode,
  type ApiResult,
  type IssuedHandoffCodeView,
} from "./client";

/**
 * Issuing a handoff code, on the two surfaces allowed to do it.
 *
 * SHOWN ONCE, AND THAT IS THE WHOLE DESIGN. The raw code exists in the issuance
 * response and in whatever the holder does with it — never in a database column,
 * never in a log, and never in a second response. So this component holds it in
 * React state and nowhere else: no `localStorage`, no `sessionStorage`, no URL,
 * no re-fetch on mount. There is no route that reads a code back, and a screen
 * that implied otherwise would teach an operator to close the panel and come
 * back for it.
 *
 * TWO CREDENTIALS, NEVER ONE. The pickup code and the recipient code go to
 * different people, are held in different generations under different HMAC
 * domains, and are described here in different words for exactly that reason: a
 * merchant who reads "your code" twice hands the driver the recipient's PIN.
 *
 * WHAT IS NEVER RENDERED: the digest, the generation, the attempt count and the
 * lock state. The response carries a generation because the server needs it;
 * showing it would invite "we're on code 4" as a status a person acts on.
 */

export type HandoffCodeKind = "merchant_pickup" | "recipient_dropoff" | "merchant_return";
export type HandoffCodeSurface = "merchant" | "operations";

/** Only the three fields this panel shows. The generation is dropped at the boundary. */
type ShownCode = {
  code: string;
  expiresAt: string;
  warning: string;
};

type Copy = {
  title: string;
  /** The one-line instruction. Distinct per kind — see the note above. */
  lead: string;
  /** The same instruction beside the digits, where it is actually read. */
  handTo: string;
  audience: string;
  issueLabel: string;
  reissueLabel: string;
  accent: string;
  shownOnceFollowup: string;
};

const COPY: Record<HandoffCodeKind, Copy> = {
  merchant_pickup: {
    title: "Pickup verification",
    lead: "Show this QR or six-digit fallback to the driver at collection.",
    handTo: "Present this to the driver at collection.",
    audience: "For pickup",
    issueLabel: "Show pickup QR & code",
    reissueLabel: "Create a new pickup code",
    accent: "var(--couranr-route-blue)",
    shownOnceFollowup: "The driver should get it from you at pickup, not in advance.",
  },
  recipient_dropoff: {
    title: "Recipient code",
    lead: "Recipient code — send this to whoever receives the delivery.",
    handTo: "Send this to whoever receives the delivery.",
    audience: "For the recipient",
    issueLabel: "Issue recipient code",
    reissueLabel: "Issue a new recipient code",
    accent: "var(--couranr-gold)",
    shownOnceFollowup: "The recipient should receive it through the delivery handoff, not from the driver.",
  },
  merchant_return: {
    title: "Return code",
    lead: "Sender return code — use this only when Couranr has required a return.",
    handTo: "Give this to the driver only when the shipment is physically back with you.",
    audience: "For the return",
    issueLabel: "Issue return code",
    reissueLabel: "Issue a new return code",
    accent: "var(--couranr-gold)",
    shownOnceFollowup: "The driver should get it from the sender only when the shipment is physically returned.",
  },
};

/**
 * The route is chosen by the surface AND the kind, exhaustively.
 *
 * A merchant call and an Operations call are authorized differently — one walks
 * the delivery's own business account, the other requires an Operations profile
 * — so this cannot be one endpoint with a role flag.
 */
function issuerFor(
  surface: HandoffCodeSurface,
  kind: HandoffCodeKind
): (deliveryId: string) => Promise<ApiResult<{ handoffCode: IssuedHandoffCodeView }>> {
  switch (surface) {
    case "merchant":
      if (kind === "merchant_pickup") return issueMerchantPickupCode;
      if (kind === "recipient_dropoff") return issueMerchantRecipientCode;
      return issueMerchantReturnCode;
    case "operations":
      if (kind === "merchant_pickup") return issueOperationsPickupCode;
      if (kind === "recipient_dropoff") return issueOperationsRecipientCode;
      return issueOperationsReturnCode;
  }
}

export function HandoffCodePanel({
  deliveryId,
  kind,
  surface,
}: {
  deliveryId: string;
  kind: HandoffCodeKind;
  surface: HandoffCodeSurface;
}) {
  const copy = COPY[kind];
  const [shown, setShown] = React.useState<ShownCode | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = React.useState(false);
  /** True once this panel has replaced a code it displayed, so the copy can say so. */
  const [replaced, setReplaced] = React.useState(false);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");

  /*
   * A displayed code belongs to ONE delivery and one kind. If a parent reuses
   * this component instance for a different delivery — the same position in the
   * tree with a new prop, which needs no key change to happen — the code in
   * state would be shown under the wrong record: a credential for delivery A
   * presented as delivery B's. Adjusting state during render is React's
   * documented answer for this (react.dev, "You Might Not Need an Effect"); an
   * Effect would repaint the stale code first.
   */
  const identity = `${surface}:${kind}:${deliveryId}`;
  const [shownFor, setShownFor] = React.useState(identity);
  if (shownFor !== identity) {
    setShownFor(identity);
    setShown(null);
    setReplaced(false);
    setConfirmingReplace(false);
    setCopyState("idle");
    setError(null);
  }

  async function issue(isReplacement: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopyState("idle");
    const r = await issuerFor(surface, kind)(deliveryId);
    setBusy(false);
    if (isApiFailure(r)) {
      // A failed issuance leaves any previously shown code on screen untouched:
      // the server either minted a new one or did nothing, and clearing the
      // panel here would destroy a working code to report an error.
      setError(withReference(r));
      return;
    }
    const issued = r.value?.handoffCode;
    // A 200 with no code is not a code. Rendering an empty box under "shown
    // once" would tell someone a credential exists that nobody can read, and
    // they would hand a driver nothing while believing the step was done.
    if (!issued || typeof issued.code !== "string" || issued.code === "") {
      setError("Couranr did not return a code. Try again, and contact Couranr Support if it repeats.");
      return;
    }
    setShown({
      code: issued.code,
      expiresAt: issued.expiresAt,
      // The warning belongs to the server so one sentence governs every surface;
      // this only covers the case where it arrives empty, and says the one thing
      // the whole design rests on rather than inventing policy.
      warning:
        typeof issued.warning === "string" && issued.warning !== ""
          ? issued.warning
          : "Couranr cannot show this code again.",
    });
    setReplaced(isReplacement);
    setConfirmingReplace(false);
  }

  async function copyCode(code: string) {
    // Clipboard access needs a secure context and a user gesture, and it can
    // still be refused. A silent failure would leave someone believing they had
    // pasted a code they never copied.
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        setCopyState("failed");
        return;
      }
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <Card>
      <CardHeader
        title={copy.title}
        description={copy.lead}
        actions={<Badge tone={kind === "merchant_pickup" ? "info" : "neutral"}>{copy.audience}</Badge>}
      />

      <Stack gap={4}>
        {error ? (
          <Alert tone="danger" title="That code was not issued">
            {error}
          </Alert>
        ) : null}

        {shown ? (
          <Stack gap={3}>
            {kind === "merchant_pickup" ? (
              <PickupCredentialDisplay
                deliveryId={deliveryId}
                code={shown.code}
              />
            ) : (
              <div
                style={{
                  borderLeft: `4px solid ${copy.accent}`,
                  background: "var(--couranr-surface-sunken)",
                  borderRadius: "var(--couranr-radius-md)",
                  padding: "var(--couranr-space-4)",
                }}
              >
                <Text size="xs" muted>{copy.handTo}</Text>
                <div
                  aria-hidden="true"
                  style={{
                    fontFamily: "var(--couranr-font-mono)",
                    fontSize: "var(--couranr-text-3xl)",
                    fontWeight: 700,
                    letterSpacing: "0.3em",
                    lineHeight: "var(--couranr-leading-tight)",
                    marginTop: "var(--couranr-space-2)",
                    wordBreak: "break-all",
                  }}
                >
                  {shown.code}
                </div>
                <VisuallyHidden>{`${copy.title}: ${shown.code.split("").join(" ")}`}</VisuallyHidden>
              </div>
            )}

            <Alert tone="warning" title="Shown once">
              {shown.warning} {copy.shownOnceFollowup}
            </Alert>

            {replaced ? (
              <Alert tone="warning" title="This replaces the previous code">
                The previous {copy.title.toLowerCase()} no longer works. Anyone holding it needs this
                one instead.
              </Alert>
            ) : null}

            {/* Omitted rather than rendered as a dash: "stops working at —" reads
                as an expiry a person might act on. */}
            {formatWhen(shown.expiresAt) === null ? null : (
              <Text size="xs" muted>
                This code stops working at {formatWhen(shown.expiresAt)}.
              </Text>
            )}

            <Cluster gap={3}>
              <Button variant="secondary" onClick={() => void copyCode(shown.code)}>
                Copy code
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  // Dropping it from state is the only way it leaves this page,
                  // and it is not recoverable afterwards — which is the point.
                  setShown(null);
                  setCopyState("idle");
                  setReplaced(false);
                }}
              >
                I have written it down
              </Button>
            </Cluster>

            {copyState === "copied" ? (
              <Text size="xs" muted role="status">
                Copied to your clipboard. It is still shown only once.
              </Text>
            ) : null}
            {copyState === "failed" ? (
              <Alert tone="warning" title="Copying is not available here">
                Your browser did not allow copying. Write the code down before you leave this page.
              </Alert>
            ) : null}
          </Stack>
        ) : null}

        {confirmingReplace ? (
          <Stack gap={3}>
            <Alert tone="warning" title="Issue a new code?">
              The code shown above stops working immediately. Whoever holds it will need the new one.
            </Alert>
            <Cluster gap={3}>
              <Button
                variant="destructive"
                loading={busy}
                loadingLabel="Issuing…"
                onClick={() => void issue(true)}
              >
                {copy.reissueLabel}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmingReplace(false)}>
                Keep the current code
              </Button>
            </Cluster>
          </Stack>
        ) : shown ? (
          <Cluster gap={3}>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmingReplace(true)}>
              {copy.reissueLabel}
            </Button>
          </Cluster>
        ) : (
          <Stack gap={2}>
            <Cluster gap={3}>
              <Button
                variant="primary"
                loading={busy}
                loadingLabel="Issuing…"
                onClick={() => void issue(false)}
              >
                {copy.issueLabel}
              </Button>
            </Cluster>
            {/*
              This panel cannot tell whether a code already exists — nothing reads
              one back, by design. Issuing supersedes every live code of this kind,
              so the caveat is stated BEFORE the press rather than discovered by
              someone whose driver is holding an invalidated code.
            */}
            <Text size="xs" muted>
              Couranr shows this code once and cannot show it again. If one was already issued for
              this delivery, issuing here replaces it and the earlier code stops working.
            </Text>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

/** Null for an unparseable timestamp, so the caller can omit the line entirely. */
function formatWhen(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}
