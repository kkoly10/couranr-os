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
import { CardSkeleton, ErrorState } from "@/components/couranr/states";
import { CouranrLogo } from "@/components/brand/CouranrLogo";
import type { TrackingProjection, TrackingProofItem } from "@/lib/couranr/tracking/projection";
import {
  PROOF_STATE_COPY,
  REFUSAL_COPY,
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_RAIL,
  STAGE_TONES,
  type TrackingStage,
} from "@/lib/couranr/tracking/states";
import { fetchProofUrl, fetchTracking } from "./client";

/**
 * PUB-006 — secure live tracking, with CUS-006 (#proof) and CUS-008 (#access).
 *
 * WHAT THIS PAGE IS NOT ALLOWED TO DO, from the registry:
 *
 *   * PUB-006: "Times are estimates. Do not show unrestricted call or
 *     customer–driver chat." There is no phone number and no message box on
 *     this page, and every time shown is labelled as the SCHEDULED PICKUP
 *     window rather than an arrival.
 *   * CUS-006: "Private storage and purpose-scoped token." The image is
 *     fetched through a route that re-authorizes and mints a 600-second URL,
 *     and nothing here caches it.
 *   * CUS-008: "Gate codes and sensitive instructions must be protected."
 *     The projection does not carry them, so this page cannot render one.
 *   * TRM-001: no 24/7 claim, no guarantee, no founder voice.
 *
 * ONE REFUSAL SENTENCE. A revoked link, an expired one and one that never
 * existed render identically — the server already collapsed them, and a
 * per-reason message here would put back exactly the distinction PHO-001
 * removes. There is no retry on a refusal, because retrying resolves nothing;
 * there IS one on a load failure, which is a different thing.
 */

type Load =
  | { phase: "loading" }
  | { phase: "refused" }
  | { phase: "failed" }
  | { phase: "ready"; tracking: TrackingProjection };

const PROOF_TYPE_LABELS: Record<string, string> = {
  delivery_photo: "Delivery photo",
  signature: "Signature",
  recipient_pin: "Recipient PIN confirmed",
};

function proofTypeLabel(t: string): string {
  return PROOF_TYPE_LABELS[t] ?? "Delivery proof";
}

/**
 * A timestamp the recipient can read, in the delivery's own timezone.
 *
 * Falls back to the raw ISO string rather than throwing: an unexpected value
 * from the server should degrade to something ugly and true, not to a blank
 * where a delivery time should be.
 */
function formatMoment(iso: string | null, timezone: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || undefined,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatWindow(t: TrackingProjection): string {
  if (!t.scheduledPickupStart) return "";
  const start = formatMoment(t.scheduledPickupStart, t.timezone);
  if (!t.scheduledPickupEnd) return start;
  // Same day: only the end time is needed on the right of the dash.
  let end: string;
  try {
    end = new Intl.DateTimeFormat("en-US", {
      timeStyle: "short",
      timeZone: t.timezone || undefined,
    }).format(new Date(t.scheduledPickupEnd));
  } catch {
    end = t.scheduledPickupEnd;
  }
  return `${start} – ${end}`;
}

export function TrackingPage({ token }: { token: string }) {
  const [load, setLoad] = React.useState<Load>({ phase: "loading" });

  const reload = React.useCallback(async () => {
    setLoad({ phase: "loading" });
    const r = await fetchTracking(token);
    if ("failed" in r) setLoad({ phase: "failed" });
    else if (r.resolved === false) setLoad({ phase: "refused" });
    else setLoad({ phase: "ready", tracking: r.tracking });
  }, [token]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Stack gap={6}>
      <header>
        <CouranrLogo />
        <VisuallyHidden>
          <h1>Couranr delivery tracking</h1>
        </VisuallyHidden>
      </header>

      {load.phase === "loading" ? (
        <>
          {/* §6: a skeleton that preserves the page structure and flashes no data. */}
          <VisuallyHidden>
            <p role="status">Loading this delivery.</p>
          </VisuallyHidden>
          <CardSkeleton lines={4} />
        </>
      ) : null}

      {load.phase === "refused" ? (
        <Card>
          <Stack gap={3}>
            <Heading level={2}>Tracking unavailable</Heading>
            {/* The one sentence. Never says which of the three reasons applies. */}
            <Text>{REFUSAL_COPY}</Text>
          </Stack>
        </Card>
      ) : null}

      {load.phase === "failed" ? (
        <ErrorState
          title="This did not load"
          body="Couranr could not reach this delivery just now. Your link is still valid."
          action={{ label: "Try again", onClick: () => void reload() }}
        />
      ) : null}

      {load.phase === "ready" ? (
        <>
          <StatusCard tracking={load.tracking} />
          <ProgressRail stage={load.tracking.stage} />
          <ProofSection token={token} tracking={load.tracking} />
          <AccessSection tracking={load.tracking} />
          <HelpCard />
        </>
      ) : null}
    </Stack>
  );
}

/* ------------------------------------------------------------- status --- */

function StatusCard({ tracking }: { tracking: TrackingProjection }) {
  const stage = tracking.stage;
  const window = formatWindow(tracking);

  return (
    <Card>
      {/*
        The title is fixed and the BADGE carries the stage. Putting the stage
        label in both read as "Delivered … Delivered" in the browser, and the
        badge is the piece that must stay — §7 forbids colour-only status, so
        the tone needs a word attached to it rather than a bare dot.
      */}
      <CardHeader
        title="Delivery status"
        actions={<Badge tone={STAGE_TONES[stage]}>{STAGE_LABELS[stage]}</Badge>}
      />
      <Stack gap={3}>
        <Heading level={2}>{STAGE_LABELS[stage]}</Heading>
        <Text>{STAGE_DESCRIPTIONS[stage]}</Text>

        {tracking.senderName ? (
          <Text size="sm" muted>
            Sent by {tracking.senderName}
          </Text>
        ) : null}

        {window ? (
          <div>
            <Text size="sm" strong>
              Scheduled pickup window
            </Text>
            <Text size="sm">{window}</Text>
            {/*
              PUB-006's mandatory correction, stated on the page rather than
              only in a comment. This is a PICKUP window — the moment the driver
              collects — and it is an estimate. Nothing here promises arrival.
            */}
            <Text size="xs" muted>
              Times are estimates. This is when Couranr expects to collect the
              delivery, not a guaranteed arrival time.
            </Text>
          </div>
        ) : null}

        {tracking.driverAssigned ? (
          <Text size="sm" muted>
            A Couranr driver is assigned to this delivery.
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

/* ---------------------------------------------------------------- rail --- */

/**
 * The progress rail.
 *
 * §7 forbids colour-only status meaning, so each step carries a word — "Done",
 * "Now", "Next" — and the whole rail is an ordered list, which is what a screen
 * reader needs to convey position. A terminal exception (cancelled, could not
 * deliver, return) is NOT on the rail: rendering "step 6 of 6" for a cancelled
 * delivery would read as success.
 */
function ProgressRail({ stage }: { stage: TrackingStage }) {
  const onRail = (STAGE_RAIL as readonly string[]).includes(stage);
  if (!onRail) return null;

  const current = STAGE_ORDER[stage];

  return (
    <Card>
      <CardHeader title="Progress" />
      <ol className="cr-stack cr-stack--2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {STAGE_RAIL.map((s) => {
          const rank = STAGE_ORDER[s];
          const state = rank < current ? "Done" : rank === current ? "Now" : "Next";
          return (
            <li
              key={s}
              aria-current={rank === current ? "step" : undefined}
              style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}
            >
              <Text size="xs" muted as="span" style={{ minWidth: "3.5rem" }}>
                {state}
              </Text>
              <Text as="span" strong={rank === current} muted={rank > current}>
                {STAGE_LABELS[s]}
              </Text>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* --------------------------------------------------------------- proof --- */

/**
 * CUS-006 — proof-of-delivery viewer.
 *
 * The image is NOT rendered on load. A signed URL lasts 600 seconds and
 * `persist_signed_urls` is false, so minting one for a page a customer may
 * leave open would produce a broken image and a spent URL. It is fetched when
 * they ask to see it, and the state is one of the four the registry names:
 * processing, verified (available), unavailable, or — handled a level up — a
 * refused token.
 */
function ProofSection({ token, tracking }: { token: string; tracking: TrackingProjection }) {
  const { state, items } = tracking.proof;

  return (
    <Card id="proof">
      <CardHeader title="Proof of delivery" />
      <Stack gap={3}>
        <Text>{PROOF_STATE_COPY[state]}</Text>

        {state === "processing" ? (
          <Alert tone="info" title="Still processing">
            Proof is recorded at the door and takes a moment to appear here.
            Check back shortly.
          </Alert>
        ) : null}

        {items.map((item) => (
          <ProofRow key={item.proofId} token={token} item={item} timezone={tracking.timezone} />
        ))}
      </Stack>
    </Card>
  );
}

function ProofRow({
  token,
  item,
  timezone,
}: {
  token: string;
  item: TrackingProofItem;
  timezone: string | null;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "failed">("idle");

  async function show() {
    setStatus("loading");
    const r = await fetchProofUrl(token, item.proofId);
    if (!r) {
      setStatus("failed");
      return;
    }
    setUrl(r.url);
    setStatus("idle");
  }

  return (
    <div>
      <Divider />
      <Stack gap={3}>
        <Text strong>{proofTypeLabel(item.proofType)}</Text>
        {item.capturedAt ? (
          <Text size="sm" muted>
            {formatMoment(item.capturedAt, timezone)}
          </Text>
        ) : null}

        {/*
          A PIN record is proof with nothing to look at. Saying so beats
          offering a button that can only fail.
        */}
        {!item.hasImage ? (
          <Text size="sm" muted>
            Confirmed with the recipient. There is no image for this record.
          </Text>
        ) : url ? (
          /*
           * A plain <img>, NOT next/image. The src is a signed URL that expires
           * in 600 seconds, and the image optimizer would fetch it server-side,
           * cache the bytes and rewrite the URL through /_next/image — which is
           * persisting a signed proof URL, exactly what PHO-001 forbids
           * (`persist_signed_urls: false`).
           *
           * The disable must sit on its own line immediately above the element;
           * a trailing `-- reason` after the rule name silently does not apply,
           * which is why the warning survived the first attempt.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`${proofTypeLabel(item.proofType)} for this delivery`}
            style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }}
          />
        ) : (
          <div>
            <Button variant="secondary" onClick={() => void show()} disabled={status === "loading"}>
              {status === "loading" ? "Opening…" : "View proof"}
            </Button>
            {status === "failed" ? (
              <Alert tone="warning" title="Could not open that image">
                Try again in a moment.
              </Alert>
            ) : null}
          </div>
        )}
      </Stack>
    </div>
  );
}

/* -------------------------------------------------------------- access --- */

/**
 * CUS-008 — delivery preferences and access instructions.
 *
 * READ-ONLY IN THIS SLICE, and the page says so rather than implying otherwise.
 * The registry's purpose for this screen is "Confirm address, access, allowed
 * handoff, leave-at-door authorization, and delivery window", and that is what
 * renders. Its allowed ACTIONS — edit instructions, choose handoff, save —
 * need a customer-supplied instruction column and a command that locks at
 * pickup, which is its own change. A disabled form pretending to be editable
 * would be worse than an honest read-only panel.
 *
 * Nothing sensitive appears here: the projection carries no gate code and no
 * dispatch instruction, so there is nothing for this section to leak.
 */
function AccessSection({ tracking }: { tracking: TrackingProjection }) {
  const d = tracking.dropoff;
  const hasAddress = Boolean(d.line1 || d.city);
  const locked = STAGE_ORDER[tracking.stage] >= STAGE_ORDER.picked_up;

  return (
    <Card id="access">
      <CardHeader title="Delivery details" />
      <Stack gap={3}>
        {hasAddress ? (
          <div>
            <Text size="sm" strong>
              Delivering to
            </Text>
            <Text size="sm">{d.line1}</Text>
            {d.line2 ? <Text size="sm">{d.line2}</Text> : null}
            <Text size="sm">
              {[d.city, d.region].filter(Boolean).join(", ")} {d.postalCode}
            </Text>
          </div>
        ) : null}

        <div>
          <Text size="sm" strong>
            Handoff
          </Text>
          <Text size="sm">
            {tracking.leaveAtDoorAuthorized
              ? "Couranr is authorized to leave this delivery at the door in a safe location."
              : tracking.signatureRequired
                ? "A signature is required at the door."
                : "This delivery is handed to the recipient."}
          </Text>
        </div>

        {locked ? (
          <Alert tone="info" title="These details are locked">
            The driver has collected this delivery, so the address and handoff
            can no longer change here. Open Delivery Help if something needs to
            change.
          </Alert>
        ) : (
          <Text size="xs" muted>
            To change the address or the handoff, open Delivery Help. Couranr
            Operations reviews every change to an active delivery.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/* ---------------------------------------------------------------- help --- */

/**
 * No phone number, by decision. TRM-001 sets `no_public_support_phone: true`
 * and a 15-minute response target DURING OPERATING HOURS — a target, never a
 * guarantee, and never "24/7".
 */
function HelpCard() {
  return (
    <Card>
      <CardHeader title="Something wrong?" />
      <Stack gap={3}>
        <Text size="sm">
          Couranr Support answers delivery questions through Delivery Help.
          During operating hours the normal response target is 15 minutes.
        </Text>
        {/*
          NOT LINKED YET, on purpose. PUB-006 lists "open Delivery Help" as an
          allowed action and `/help/[token]` is the next change in this slice;
          a button pointing at a 404 is worse than none, so the affordance
          lands with the page it opens.
        */}
      </Stack>
    </Card>
  );
}
