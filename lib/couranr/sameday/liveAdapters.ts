/**
 * The LIVE Same Day adapters — the one place `/send` talks to the consumer API
 * (batch 3 §D).
 *
 * Everything here is a thin, honest mapping over the seven
 * `/api/couranr/consumer/*` routes. The rules that shaped it:
 *
 * - EVERY payload is read from its NAMED nested key (`guestSession`,
 *   `suggestions`, `estimate`, `request`, `payment`) and NEVER from the flat
 *   body. A flat read is exactly how proof upload shipped dead: the value was
 *   `undefined`, `fetch(undefined)` hit the page URL, and a 200 lied for the
 *   flow's whole life. A body without the named key is treated as a failure.
 * - THE BROWSER NEVER CHOOSES an amount, a state, or a target. The estimate
 *   body carries place identities, contact and a structured shipment
 *   statement; the server derives route, market, policy and price. The one
 *   payment amount this module ever holds (`amountCents`) is the server's
 *   echo of its own stored obligation, displayed and never sent back.
 * - CONSUMER SMART INTAKE (INT-002): `readIntake` still shows the visitor's
 *   OWN words as the summary — the model's free text never renders — but posts
 *   the description to the interpret route, which (behind
 *   COURANR_CONSUMER_INTAKE=live) returns PROPOSAL-only structured facts the
 *   guest confirms by an explicit form choice. Deterministic structured
 *   pricing/safety on the Business portal's own engine remains the always-on
 *   path; a switched-off feature, a rate limit or a network failure degrades
 *   to the words alone.
 * - The guest session is minted ONCE and kept in memory plus sessionStorage
 *   (`couranr-send-guest`). Storage can THROW — private windows, blocked site
 *   data — so every touch is wrapped and the adapter degrades to memory-only.
 *   Re-minting mid-flow would orphan the draft (the contact snapshot is frozen
 *   at creation), which is why the stored copy is validated before reuse and
 *   why `quote` refuses to run before contact exists.
 */
import type {
  AddressSearchResult,
  AddressSuggestion,
  AvailabilityVerdict,
  ConsumerRequestReading,
  IntakeProposal,
  IntakeReading,
  PaymentOutcome,
  PaymentReconciliation,
  PickupCredentialReading,
  ReadinessOutcome,
  QuoteInput,
  QuoteLineItem,
  QuoteReading,
  SameDayAdapters,
  SubmitOutcome,
} from "./adapters";
import { parseOperatingLocal, type TimingIntent } from "@/lib/couranr/timing/policy";

import {
  CONSUMER_EMAIL_RE,
  CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS,
  declaredValueDollars,
  evaluateConsumerProtectionAvailability,
  isProtectionUnavailable,
} from "@/lib/couranr/consumer/protection";
/* ------------------------------------------------------------ constants -- */

export const GUEST_STORAGE_KEY = "couranr-send-guest";
export const GUEST_HEADER = "x-couranr-guest";

const API = {
  session: "/api/couranr/consumer/session",
  places: "/api/couranr/consumer/places",
  estimate: "/api/couranr/consumer/estimate",
  submit: "/api/couranr/consumer/submit",
  request: "/api/couranr/consumer/request",
  pay: "/api/couranr/consumer/pay",
  reconcile: "/api/couranr/consumer/reconcile-payment",
  readiness: "/api/couranr/consumer/readiness",
  refresh: "/api/couranr/consumer/refresh-quote",
  interpret: "/api/couranr/consumer/interpret",
  pickupManifest: "/api/couranr/consumer/pickup-manifest",
  pickupCode: "/api/couranr/consumer/pickup-code",
  recoverSender: "/api/couranr/consumer/recover-sender",
  helpLink: "/api/couranr/consumer/help-link",
  cancellationReview: "/api/couranr/consumer/cancellation-review",
  driverFeedback: "/api/couranr/consumer/driver-feedback",
} as const;

/** The two review reasons that are about the TRIP rather than the shipment. */
const ROUTE_REVIEW_REASONS = ["route_needs_review", "market_needs_review"] as const;

const NOTES = {
  serviceDown: "Couranr could not reach the delivery service. Try again.",
  bothAddresses: "Enter both a pickup and a destination.",
  chooseSuggestions: "Choose both addresses from the suggestions.",
  weightRequired: "Enter the weight, or choose the honest range.",
  safetyDeclarationRequired:
    "Choose whether the shipment contains any listed restricted item before Couranr prices it.",
  descriptionRequired: "Tell Couranr what the driver should look for at pickup.",
  descriptionTooLong: "Keep the pickup description to 1,000 characters or fewer.",
  packageCountInvalid: "Package count must be a whole number from 1 to 9,999, or left blank.",
  contactRequired: "Add your email on the review step, then check the price.",
  /* EMAIL-FIRST. A phone cannot substitute: email is the transactional channel
     for the confirmation, the tracking link and any claim. */
  senderEmailInvalid: "Check your email address — Couranr could not read it.",
  senderNameRequired: "Enter your name — it goes on the shipment record you are certifying.",
  recipientEmailMismatch:
    "The two recipient email addresses do not match. Check both — the tracking link goes to this address and nowhere else.",
  recipientNameRequired: "Enter the name of the person receiving this delivery.",
  recipientEmailRequired: "Enter the recipient's email so Couranr can send them the tracking link.",
  recipientEmailInvalid: "Check the recipient's email address — Couranr could not read it.",
  declaredValueRequired: "Enter what this shipment is worth, in whole dollars.",
  /* COMPOSED FROM AUTHORITY, and it names the ACCEPTED maximum rather than the
     policy ceiling. It used to type "$500", which was the policy number and
     useless advice: a sender at $600 told to go under $500 would enter $400
     and be refused again. */
  declaredValueTooHigh:
    "Couranr Same Day currently carries shipments declared up to "
    + `${declaredValueDollars(CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS)}. Enter a lower value.`,

  /* Inside policy, but the tier it derives to cannot be bought yet. A

     DISTINCT note: telling a sender $200 is over the maximum would be

     false, and it is not the message that helps them. */

  declaredValueUnavailable:

    "Protected Handoff is not available yet. Lower the declared value to continue.",
  certificationRequired: "Confirm what you are shipping before Couranr can price it.",
  electronicConsentRequired: "Agree to electronic records before Couranr can price it.",
  scheduledTimeRequired: "Choose the date and time for your scheduled pickup.",
  review: "Couranr will review this delivery and confirm the price with you.",
  // Timing-specific review reasons name WHY, so the sender is not left guessing.
  overnightReview: "Couranr must confirm a pickup outside standard hours before it can be priced.",
  timingReview: "Couranr will confirm this pickup time with you before it can be priced.",
  cannotCarry: "Couranr can’t deliver this item.",
  cannotPrice: "Couranr could not price this delivery right now.",
  notPayable: "Payment isn’t open for this delivery yet.",
} as const;

/* ----------------------------------------------------------------- deps -- */

/** The two storage calls this module makes. Anything Storage-like fits. */
export type MinimalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type LiveAdapterDeps = {
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Injectable for tests. `undefined` means "use sessionStorage when it
   * works"; an explicit `null` means memory-only.
   */
  storage?: MinimalStorage | null;
};

function defaultStorage(): MinimalStorage | null {
  try {
    if (typeof window === "undefined") return null;
    // The ACCESSOR itself can throw when site data is blocked.
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------- pure mappings -- */

/** The proposal keys a guest may be shown — mirrors the server allow-list:
    closed-vocabulary, numeric or boolean facts only, never a free string. */
export const INTAKE_PROPOSAL_KEYS = [
  "quantity",
  "package_count",
  "weight_lb_exact",
  "weight_band",
  "fragile",
  "restricted_class",
] as const;

/** The server's `intake.proposals`, kept only where every field has its shape. */
export function proposalsFromIntake(intake: unknown): IntakeProposal[] {
  const raw = (intake as { proposals?: unknown } | null)?.proposals;
  if (!Array.isArray(raw)) return [];
  const out: IntakeProposal[] = [];
  for (const p of raw as Array<Record<string, unknown>>) {
    if (!p || typeof p !== "object") continue;
    const key = typeof p.key === "string" ? p.key : "";
    if (!(INTAKE_PROPOSAL_KEYS as readonly string[]).includes(key)) continue;
    if (p.value === undefined) continue;
    out.push({
      key,
      value: p.value,
      confidence: typeof p.confidence === "number" ? p.confidence : null,
      requiresConfirmation: p.requiresConfirmation !== false,
    });
  }
  return out;
}

/** The one clarification question, or null. */
export function clarificationFromIntake(intake: unknown): string | null {
  const q = (intake as { clarification?: { question?: unknown } } | null)?.clarification?.question;
  return typeof q === "string" && q.trim() !== "" ? q : null;
}

/**
 * UI contact -> API contact. The UI field is `mobile`; the API and the
 * database key is `phone`. Empty strings become null — the server treats
 * absence honestly and a "" would defeat its has-contact checks.
 */
export function consumerContactFromSend(c?: {
  name?: string;
  mobile?: string;
  email?: string;
}): { name: string | null; phone: string | null; email: string | null } {
  const s = (v?: string) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  return { name: s(c?.name), phone: s(c?.mobile), email: s(c?.email) };
}

export type EstimateBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; note: string };

/**
 * `tsconfig` sets `"strict": false`; without `strictNullChecks` a bare
 * `if (!r.ok)` does not narrow this union. An explicit predicate does.
 */
export function isEstimateBodyFailure(
  r: EstimateBodyResult
): r is { ok: false; note: string } {
  return r.ok === false;
}

/**
 * Build the estimate request body, or say plainly what is still missing.
 * Refusals here are LOCAL and free — no network call happens until the body
 * can be an honest, complete statement. Contact is required even though the
 * server would accept its absence for an estimate, because the FIRST estimate
 * creates the draft and freezes the contact snapshot; a contactless draft can
 * never be submitted.
 */
export function buildEstimateBody(input: QuoteInput): EstimateBodyResult {
  const pickupPlaceId = (input.pickupPlaceId ?? "").trim();
  const dropoffPlaceId = (input.dropoffPlaceId ?? "").trim();
  if (!pickupPlaceId || !dropoffPlaceId) {
    return { ok: false, note: NOTES.chooseSuggestions };
  }

  const ship = input.shipment;
  const weightLb =
    typeof ship?.weightLb === "number" && Number.isFinite(ship.weightLb) && ship.weightLb > 0
      ? ship.weightLb
      : null;
  const weightBand =
    typeof ship?.weightBand === "string" && ship.weightBand.trim() !== ""
      ? ship.weightBand
      : null;
  if (weightLb === null && weightBand === null) {
    return { ok: false, note: NOTES.weightRequired };
  }

  const contact = consumerContactFromSend(input.contact);
  // EMAIL-FIRST (V1). The old rule was phone OR email; the server now requires
  // the email and the phone stays optional. These two gates must agree exactly
  // — tests/couranr-consumer-send-contract.test.ts holds them together.
  if (!contact.name) return { ok: false, note: NOTES.senderNameRequired };
  if (!contact.email) return { ok: false, note: NOTES.contactRequired };
  if (!CONSUMER_EMAIL_RE.test(contact.email)) {
    return { ok: false, note: NOTES.senderEmailInvalid };
  }

  const recipient = consumerContactFromSend(input.recipient);
  if (!recipient.name) return { ok: false, note: NOTES.recipientNameRequired };
  if (!recipient.email) return { ok: false, note: NOTES.recipientEmailRequired };
  if (!CONSUMER_EMAIL_RE.test(recipient.email)) {
    return { ok: false, note: NOTES.recipientEmailInvalid };
  }

  /* M — TYPO RISK. The recipient email carries a private bearer capability: the
     adult attestation, identity verification and the handoff PIN all live behind
     the link sent to it. A single mistyped character delivers all three to a
     stranger, and unlike a wrong phone number nothing bounces back to say so.
     
     Confirmed by re-entry, compared on the NORMALIZED value so case and
     surrounding spaces do not produce a false mismatch. The confirmation is a
     CLIENT-SIDE gate and is deliberately never persisted — a second stored copy
     of an address is a second thing to keep in sync and adds no evidence. */
  const confirm = (input.recipientEmailConfirm ?? "").trim().toLowerCase();
  if (confirm !== recipient.email.trim().toLowerCase()) {
    return { ok: false, note: NOTES.recipientEmailMismatch };
  }

  /* DECLARED VALUE, judged by the SAME authority the server and the database
     use. Refusing here is free; refusing at the server costs a round trip and,
     on this path, provider lookups the owner pays for. What is NOT done here is
     deriving the level — that is the server's alone, and the browser never
     sends one. */
  /* AVAILABILITY, not only policy — and this gate is the reason the contract
     test exists. `SendFlow` was corrected to refuse an unbuyable tier while
     THIS builder still accepted it, so the client would have handed the server a
     body the server refuses. Client-refuses/server-accepts is merely
     conservative; client-accepts/server-refuses is the outage. */
  const protection = evaluateConsumerProtectionAvailability(input.declaredValueCents);
  if (isProtectionUnavailable(protection)) {
    return {
      ok: false,
      note:
        protection.reason === "declared_value_above_maximum"
          ? NOTES.declaredValueTooHigh
          : protection.reason === "protection_level_unavailable"
            ? NOTES.declaredValueUnavailable
            : NOTES.declaredValueRequired,
    };
  }
  const declaredValueCents = input.declaredValueCents as number;

  /* Booleans, compared with ===. Truthiness is not consent. NOT required to
     price: the estimate creates a draft, and asking the sender to accept terms
     before Couranr has told them the cost is the wrong order. The /send review
     step gates "Continue to payment" on both, which is the submit that takes
     the request out of draft — the same line the database draws. */
  const acceptance = {
    shipmentCertification: input.acceptance?.shipmentCertification === true,
    electronicTransactions: input.acceptance?.electronicTransactions === true,
  };

  // TMZ-001: a scheduled pickup needs the sender's local wall-clock words in
  // the `YYYY-MM-DDTHH:MM` shape. Checked locally and for free; the SERVER
  // derives the canonical America/New_York instant and the database re-derives
  // it — nothing here picks a zone or an instant.
  const timingIntent: TimingIntent = input.timingIntent === "scheduled" ? "scheduled" : "asap";
  const requestedPickupLocal = (input.requestedPickupLocal ?? "").trim();
  if (timingIntent === "scheduled" && !parseOperatingLocal(requestedPickupLocal)) {
    return { ok: false, note: NOTES.scheduledTimeRequired };
  }

  const description =
    typeof ship?.description === "string" && ship.description.trim() !== ""
      ? ship.description.trim()
      : null;
  if (!description) return { ok: false, note: NOTES.descriptionRequired };
  if (description.length > 1000) return { ok: false, note: NOTES.descriptionTooLong };

  const restrictedClass =
    typeof ship?.restrictedClass === "string" ? ship.restrictedClass.trim() : "";
  if (!restrictedClass || restrictedClass === "unknown") {
    return { ok: false, note: NOTES.safetyDeclarationRequired };
  }

  const packageCount =
    ship?.packageCount === null || ship?.packageCount === undefined
      ? null
      : Number(ship.packageCount);
  if (
    packageCount !== null &&
    (!Number.isInteger(packageCount) || packageCount < 1 || packageCount > 9999)
  ) {
    return { ok: false, note: NOTES.packageCountInvalid };
  }

  return {
    ok: true,
    body: {
      pickupPlaceId,
      dropoffPlaceId,
      contact,
      recipient,
      declaredValueCents,
      acceptance,
      shipment: {
        description,
        weightLb,
        weightBand,
        // Direct Same Day requires the sender's explicit declaration. The
        // server independently enforces the same rule.
        restrictedClass,
        signatureRequired: ship?.signatureRequired === true,
        overnightRequested: ship?.overnightRequested === true,
      },
      // The sender's timing statement — ASAP, or the local Eastern words for
      // a scheduled pickup. The server evaluates the doctrine and owns the
      // instant; the browser never sends a zone or a timestamp.
      timing: {
        intent: timingIntent,
        requestedPickupLocal: timingIntent === "scheduled" ? requestedPickupLocal : null,
      },
    },
  };
}

/** The estimate payload, as the route nests it under `estimate`. */
type EstimateLike = {
  requestId?: unknown;
  quoteStatus?: unknown;
  pickupManifestVersion?: unknown;
  totalCents?: unknown;
  lineItems?: unknown;
  reviewReasons?: unknown;
  quoteVersionId?: unknown;
  expiresAt?: unknown;
  timing?: unknown;
};

/** The server's timing echo, kept only where every field has its shape. */
export function quoteLineItemsFrom(raw: unknown): QuoteLineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QuoteLineItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const quantity = Number(row.quantity);
    const amountCents = Number(row.amountCents);
    const unitAmountCents = Number(row.unitAmountCents);
    if (
      !code ||
      !label ||
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      !Number.isInteger(amountCents) ||
      amountCents < 0 ||
      !Number.isInteger(unitAmountCents) ||
      unitAmountCents < 0
    ) continue;
    out.push({ code, label, quantity, amountCents, unitAmountCents });
  }
  return out;
}

export function timingFromEstimate(
  raw: unknown
): { intent: TimingIntent; requestedPickupLocal: string | null } | null {
  const t = raw as { intent?: unknown; requestedPickupLocal?: unknown } | null;
  if (!t || typeof t !== "object") return null;
  const intent: TimingIntent | null =
    t.intent === "scheduled" ? "scheduled" : t.intent === "asap" ? "asap" : null;
  if (!intent) return null;
  return {
    intent,
    requestedPickupLocal:
      typeof t.requestedPickupLocal === "string" ? t.requestedPickupLocal : null,
  };
}

/**
 * The review note for a manual_review_required estimate. When the reason is
 * TIMING (the overnight window, or a time Couranr must confirm) the note says
 * so — vocabulary from lib/couranr/routing/canonicalRoute.ts — else the generic
 * review posture.
 */
export function reviewNoteFor(reviewReasons: unknown): string {
  const reasons = Array.isArray(reviewReasons) ? reviewReasons : [];
  if (reasons.includes("overnight_requires_couranr_confirmation")) return NOTES.overnightReview;
  if (reasons.includes("timing_needs_review")) return NOTES.timingReview;
  return NOTES.review;
}

/**
 * quoteStatus -> QuoteReading. `estimated` is the only payable answer;
 * `manual_review_required` keeps the existing review-needed presentation;
 * everything else (`invalid` = policy-prohibited, `not_quoted`) refuses.
 */
export function quoteReadingFromEstimate(est: EstimateLike): QuoteReading {
  const quoteStatus = typeof est.quoteStatus === "string" ? est.quoteStatus : "";
  const requestId = typeof est.requestId === "string" ? est.requestId : "";
  if (quoteStatus === "estimated" && typeof est.totalCents === "number" && requestId) {
    const timing = timingFromEstimate(est.timing);
    return {
      state: "live-available",
      totalCents: est.totalCents,
      lineItems: quoteLineItemsFrom(est.lineItems),
      quoteVersionId: typeof est.quoteVersionId === "string" ? est.quoteVersionId : null,
      requestId,
      expiresAt: typeof est.expiresAt === "string" ? est.expiresAt : null,
      ...(timing ? { timing } : {}),
    };
  }
  if (quoteStatus === "manual_review_required") {
    return { state: "manual-review", note: reviewNoteFor(est.reviewReasons) };
  }
  if (quoteStatus === "invalid") {
    return { state: "unavailable", note: NOTES.cannotCarry };
  }
  return { state: "unavailable", note: NOTES.cannotPrice };
}

/** Is this stored review reason about the route/market rather than the item? */
export function isRouteReviewReason(reason: unknown): boolean {
  return (
    typeof reason === "string" && (ROUTE_REVIEW_REASONS as readonly string[]).includes(reason)
  );
}

/**
 * The sanitized server failure message, or the fallback. The public error
 * body is `{ error: string, code, correlationId }` — built exclusively by
 * `publicError`, so it is safe to show.
 */
function noteFromFailure(body: unknown, fallback: string): string {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === "string" && e.trim() !== "" ? e : fallback;
}

/* -------------------------------------------------------------- factory -- */

type GuestRecord = { token: string; expiresAt: string };

function guestUsable(g: GuestRecord | null): g is GuestRecord {
  if (!g || typeof g.token !== "string" || g.token === "") return false;
  const t = Date.parse(g.expiresAt);
  // A 60s margin so a request never leaves with a token about to lapse.
  return Number.isFinite(t) && t - 60_000 > Date.now();
}

export function createLiveSameDayAdapters(
  deps: LiveAdapterDeps = {}
): Omit<SameDayAdapters, "mode"> {
  const fetchImpl: typeof fetch =
    deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;

  /** Memory is the source of truth; storage is a best-effort convenience. */
  let guest: GuestRecord | null = null;
  /** What the last estimate said — feeds checkAvailability and submit. */
  let lastEstimate: {
    requestId: string | null;
    quoteStatus: string;
    reviewReasons: unknown[];
  } | null = null;
  /** Independent from the commercial request version. */
  let pickupManifestVersion = 0;

  function readStoredGuest(): GuestRecord | null {
    try {
      const raw = storage?.getItem(GUEST_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GuestRecord;
      return guestUsable(parsed) ? { token: parsed.token, expiresAt: parsed.expiresAt } : null;
    } catch {
      return null; // Storage threw or held junk: degrade to memory.
    }
  }

  function persistGuest(g: GuestRecord): void {
    try {
      storage?.setItem(GUEST_STORAGE_KEY, JSON.stringify(g));
    } catch {
      /* Memory-only from here — the flow still works for this mount. */
    }
  }

  async function ensureGuest(): Promise<GuestRecord | null> {
    if (guestUsable(guest)) return guest;
    const stored = readStoredGuest();
    if (stored) {
      guest = stored;
      return guest;
    }
    try {
      const res = await fetchImpl(API.session, { method: "POST", cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as {
        guestSession?: { token?: unknown; expiresAt?: unknown };
      } | null;
      // NESTED key, never the flat body.
      const gs = body?.guestSession;
      if (!gs || typeof gs.token !== "string" || gs.token === "") return null;
      guest = {
        token: gs.token,
        expiresAt: typeof gs.expiresAt === "string" ? gs.expiresAt : "",
      };
      persistGuest(guest);
      return guest;
    } catch {
      return null;
    }
  }

  /** One gated call: header, no-store, parsed body. `null` res = network down. */
  async function guestCall(
    path: string,
    init: { method: "GET" | "POST"; body?: Record<string, unknown> }
  ): Promise<{ ok: boolean; status: number; body: unknown } | null> {
    const g = await ensureGuest();
    if (!g) return null;
    try {
      const res = await fetchImpl(path, {
        method: init.method,
        cache: "no-store",
        headers: {
          [GUEST_HEADER]: g.token,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      return { ok: res.ok, status: res.status, body };
    } catch {
      return null;
    }
  }

  return {
    async requestCancellationReview(note: string, idempotencyKey: string): Promise<boolean> {
      const r = await guestCall(API.cancellationReview, {
        method: "POST", body: { note, idempotencyKey },
      });
      return Boolean(r?.ok && (r.body as { review?: { eventId?: unknown } } | null)?.review?.eventId);
    },
    async driverFeedback(body?: Record<string, unknown>) {
      const r = await guestCall(API.driverFeedback,
        body === undefined ? { method: "GET" } : { method: "POST", body });
      if (!r) return { error: NOTES.serviceDown };
      return r.body as {
        feedback?: import("@/lib/couranr/driver/feedbackTypes").FeedbackView;
        tip?: { clientSecret: string | null; state: string; amountCents: number };
        error?: string;
      } | null;
    },

    async openDeliveryHelp(): Promise<string | null> {
      const r = await guestCall(API.helpLink, { method: "POST" });
      if (!r?.ok) return null;
      const path = (r.body as { help?: { path?: unknown } } | null)?.help?.path;
      return typeof path === "string" && path.startsWith("/help/") ? path : null;
    },
    async recoverSenderAccess(token: string): Promise<boolean> {
      try {
        const res = await fetchImpl(API.recoverSender, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) return false;
        const body = (await res.json().catch(() => null)) as {
          guestSession?: { token?: unknown; expiresAt?: unknown };
        } | null;
        const recovered = body?.guestSession;
        if (typeof recovered?.token !== "string" || typeof recovered?.expiresAt !== "string") return false;
        guest = { token: recovered.token, expiresAt: recovered.expiresAt };
        persistGuest(guest);
        return true;
      } catch {
        return false;
      }
    },
    async searchAddress(query: string): Promise<AddressSearchResult> {
      const q = query.trim();
      // Min-3 mirrors the server autocomplete's own gate; below it there is no
      // provider call and nothing to distinguish, so it is a clean empty.
      if (q.length < 3) return { status: "ok", suggestions: [] };
      const r = await guestCall(`${API.places}?query=${encodeURIComponent(q)}`, {
        method: "GET",
      });
      // A dead network or a failed session mint is a SERVICE failure, not "no
      // matches" — the UI must be able to say so.
      if (!r) return { status: "error" };
      // The per-guest throttle refused: a distinct outcome with a wait remedy.
      if (r.status === 429) return { status: "rate-limited" };
      if (!r.ok) return { status: "error" };
      const body = r.body as { suggestions?: unknown; degraded?: unknown } | null;
      // The route flags a provider outage/budget stop as `degraded`: an empty
      // list that is a FAILURE, not a genuine no-result.
      if (body?.degraded === true) return { status: "error" };
      // NESTED key: `suggestions`.
      const raw = body?.suggestions;
      if (!Array.isArray(raw)) return { status: "error" };
      const out: AddressSuggestion[] = [];
      for (const item of raw as Array<Record<string, unknown>>) {
        const placeId = typeof item?.placeId === "string" ? item.placeId : "";
        // Either shape: { mainText, secondaryText } or the single { text }.
        const mainText = typeof item?.mainText === "string" ? item.mainText : "";
        const secondaryText = typeof item?.secondaryText === "string" ? item.secondaryText : "";
        const text = typeof item?.text === "string" ? item.text : "";
        const label = mainText || text;
        if (placeId && label) out.push({ id: placeId, label, detail: secondaryText });
      }
      return { status: "ok", suggestions: out };
    },

    async checkAvailability(pickup: string, destination: string): Promise<AvailabilityVerdict> {
      if (!pickup || !destination) {
        return { state: "unavailable", note: NOTES.bothAddresses };
      }
      /* HONEST PASSTHROUGH. There is no availability dry-run on the consumer
         API; the estimate is the real verdict. What this adapter can say
         truthfully: when the LAST estimate refused for a route/market reason,
         this trip needs Couranr review; otherwise nothing is known against it. */
      if (
        lastEstimate &&
        lastEstimate.quoteStatus === "manual_review_required" &&
        lastEstimate.reviewReasons.some(isRouteReviewReason)
      ) {
        return {
          state: "review-needed",
          note: "Couranr will confirm this trip before scheduling.",
        };
      }
      return { state: "eligible" };
    },

    async readIntake(text: string): Promise<IntakeReading> {
      /* INT-002: the guest's words are interpreted on the SAME Smart Intake
         substrate merchants use. The summary shown is STILL the guest's own
         words — the model's free text never renders. What comes back is a
         list of STRUCTURED proposals the guest must choose on the form, plus
         at most one clarification question. A switched-off feature, a rate
         limit, a refusal or a network failure degrades to the words alone. */
      const t = text.trim();
      if (!t) return { state: "unavailable" };
      const r = await guestCall(API.interpret, { method: "POST", body: { description: t } });
      // NESTED key: `intake`.
      const intake = r && r.ok ? (r.body as { intake?: unknown } | null)?.intake : null;
      const proposals = proposalsFromIntake(intake);
      const question = clarificationFromIntake(intake);
      if (question) return { state: "needs-follow-up", question, proposals };
      return { state: "interpreted", summary: t, proposals };
    },

    async quote(input: QuoteInput): Promise<QuoteReading> {
      const built = buildEstimateBody(input);
      if (isEstimateBodyFailure(built)) return { state: "unavailable", note: built.note };
      const r = await guestCall(API.estimate, { method: "POST", body: built.body });
      if (!r) return { state: "unavailable", note: NOTES.serviceDown };
      if (!r.ok) {
        return { state: "unavailable", note: noteFromFailure(r.body, NOTES.cannotPrice) };
      }
      // NESTED key: `estimate`.
      const est = (r.body as { estimate?: EstimateLike } | null)?.estimate;
      if (!est || typeof est !== "object") {
        return { state: "unavailable", note: NOTES.cannotPrice };
      }
      const requestId = typeof est.requestId === "string" ? est.requestId : null;
      if (!requestId) return { state: "unavailable", note: NOTES.cannotPrice };

      // Every estimate echoes the CURRENT independent pickup-manifest CAS.
      // This closes the reload/two-tab hole: a re-estimate after a page reload
      // does not guess generation 0 and cannot silently overwrite a newer
      // sender statement.
      const estimateManifestVersion = Number(est.pickupManifestVersion);
      const expectedManifestVersion =
        Number.isInteger(estimateManifestVersion) && estimateManifestVersion >= 0
          ? estimateManifestVersion
          : pickupManifestVersion;

      // Expected-pickup identity is committed only after the canonical estimate
      // has created/bound this guest's request. This RPC is free; all local
      // manifest validation happened before the route/price provider call.
      const manifest = await guestCall(API.pickupManifest, {
        method: "POST",
        body: {
          expectedManifestVersion,
          description: input.shipment?.description ?? "",
          packageCount: input.shipment?.packageCount ?? null,
          orderReference: input.shipment?.orderReference ?? null,
          handlingNotes: null,
        },
      });
      if (!manifest || !manifest.ok) {
        return {
          state: "unavailable",
          note: noteFromFailure(manifest?.body, "Couranr could not save the pickup details."),
        };
      }
      const manifestView = (manifest.body as {
        pickupManifest?: { manifestVersion?: unknown };
      } | null)?.pickupManifest;
      if (!manifestView || !Number.isInteger(Number(manifestView.manifestVersion))) {
        return { state: "unavailable", note: "Couranr could not confirm the pickup details." };
      }
      pickupManifestVersion = Number(manifestView.manifestVersion);

      lastEstimate = {
        requestId,
        quoteStatus: typeof est.quoteStatus === "string" ? est.quoteStatus : "",
        reviewReasons: Array.isArray(est.reviewReasons) ? est.reviewReasons : [],
      };
      return quoteReadingFromEstimate(est);
    },

    async submitRequest(statement): Promise<SubmitOutcome> {
      /* Refused LOCALLY and for free when the sender has not actually stated
         it. The server refuses the same thing again — this is the gate that can
         say so without a round trip, and without the generic failure a server
         refusal would render as. */
      if (!statement || statement.declaredValueCents === null) {
        return { state: "unavailable", note: NOTES.declaredValueRequired };
      }
      if (!statement.acceptance.shipmentCertification) {
        return { state: "unavailable", note: NOTES.certificationRequired };
      }
      if (!statement.acceptance.electronicTransactions) {
        return { state: "unavailable", note: NOTES.electronicConsentRequired };
      }
      const r = await guestCall(API.submit, {
        method: "POST",
        // The body carries the sender's own representation and their two
        // acknowledgements. No price, no state, no target, no level.
        body: {
          declaredValueCents: statement.declaredValueCents,
          acceptance: statement.acceptance,
        },
      });
      if (!r) return { state: "unavailable", note: NOTES.serviceDown };
      if (!r.ok) {
        return {
          state: "unavailable",
          note: noteFromFailure(r.body, "Couranr could not take this request. Try again."),
        };
      }
      // NESTED key: `request`.
      const req = (r.body as { request?: { state?: unknown } } | null)?.request;
      if (!req || typeof req.state !== "string") {
        return {
          state: "unavailable",
          note: "Couranr could not confirm this request was received.",
        };
      }
      return { state: "received", requestId: lastEstimate?.requestId ?? null };
    },

    async authorizePayment(): Promise<PaymentOutcome> {
      const r = await guestCall(API.pay, { method: "POST" });
      if (!r) return { state: "not-payable", note: NOTES.serviceDown };
      if (!r.ok) {
        /* QVL-001 (review item 2): an expired quote has a SPECIFIC remedy —
           re-estimate, which mints Quote N+1 — so it maps to its own state
           instead of a dead end. Everything else is the review posture: the
           manual path, or a request already authorized and under review; the
           server's message says exactly which. */
        const code = (r.body as { code?: unknown } | null)?.code;
        if (code === "quote_expired") {
          return { state: "quote-expired", note: noteFromFailure(r.body, NOTES.cannotPrice) };
        }
        return { state: "not-payable", note: noteFromFailure(r.body, NOTES.notPayable) };
      }
      // NESTED key: `payment`.
      const p = (r.body as {
        payment?: { clientSecret?: unknown; amountCents?: unknown };
      } | null)?.payment;
      if (
        !p ||
        typeof p.clientSecret !== "string" ||
        p.clientSecret === "" ||
        typeof p.amountCents !== "number"
      ) {
        return { state: "not-available", note: NOTES.serviceDown };
      }
      /* The amount is the server's echo of its stored obligation. It is shown
         to the payer and NEVER sent anywhere — the intent already carries it. */
      return {
        state: "authorization-required",
        clientSecret: p.clientSecret,
        amountCents: p.amountCents,
      };
    },

    async refreshQuote(): Promise<QuoteReading> {
      /* No body AT ALL: the server re-prices from the request's stored
         canonical facts. Nothing local survives a reload, and nothing local
         is authoritative anyway. */
      const r = await guestCall(API.refresh, { method: "POST" });
      if (!r) return { state: "unavailable", note: NOTES.serviceDown };
      if (!r.ok) {
        return { state: "unavailable", note: noteFromFailure(r.body, NOTES.cannotPrice) };
      }
      const est = (r.body as { estimate?: EstimateLike } | null)?.estimate;
      if (!est || typeof est !== "object") {
        return { state: "unavailable", note: NOTES.cannotPrice };
      }
      const reading = quoteReadingFromEstimate(est);
      if (reading.state === "live-available") {
        lastEstimate = {
          requestId: reading.requestId,
          quoteStatus: "estimated",
          reviewReasons: [],
        };
      }
      return reading;
    },

    async reconcilePayment(): Promise<PaymentReconciliation> {
      const r = await guestCall(API.reconcile, { method: "POST" });
      if (!r || !r.ok) return { outcome: undefined, paymentState: null };
      // NESTED key: `payment`. `paymentState` is the field the route returns;
      // `state` is accepted as a fallback spelling of the same server fact.
      const p = (r.body as {
        payment?: { outcome?: unknown; paymentState?: unknown; state?: unknown };
      } | null)?.payment;
      if (!p || typeof p !== "object") return { outcome: undefined, paymentState: null };
      const paymentState =
        typeof p.paymentState === "string"
          ? p.paymentState
          : typeof p.state === "string"
            ? p.state
            : null;
      return {
        outcome: typeof p.outcome === "string" ? p.outcome : undefined,
        paymentState,
      };
    },

    async setPickupReadiness(
      readiness: "ready" | "not_ready"
    ): Promise<ReadinessOutcome> {
      const r = await guestCall(API.readiness, {
        method: "POST",
        body: { readiness },
      });
      if (!r) return { ok: false, note: NOTES.serviceDown };
      if (!r.ok) {
        return {
          ok: false,
          note: noteFromFailure(r.body, "Couranr could not save pickup readiness."),
        };
      }
      const value = (r.body as {
        readiness?: { state?: unknown };
      } | null)?.readiness;
      if (
        !value ||
        (value.state !== "ready" && value.state !== "not_ready")
      ) {
        return { ok: false, note: "Couranr could not confirm pickup readiness." };
      }
      return { ok: true, state: value.state };
    },

    async issuePickupCredential(): Promise<PickupCredentialReading> {
      const r = await guestCall(API.pickupCode, { method: "POST" });
      if (!r) return { ok: false, note: NOTES.serviceDown };
      if (!r.ok) {
        return {
          ok: false,
          note: noteFromFailure(r.body, "The pickup code is not available yet."),
        };
      }
      const value = (r.body as {
        pickupCredential?: {
          deliveryId?: unknown;
          code?: unknown;
          expiresAt?: unknown;
          warning?: unknown;
        };
      } | null)?.pickupCredential;
      if (
        !value ||
        typeof value.deliveryId !== "string" ||
        typeof value.code !== "string" ||
        !/^\d{6}$/.test(value.code)
      ) {
        return { ok: false, note: "Couranr could not confirm the pickup code." };
      }
      return {
        ok: true,
        deliveryId: value.deliveryId,
        code: value.code,
        expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : undefined,
        warning: typeof value.warning === "string" ? value.warning : undefined,
      };
    },

    async readRequest(): Promise<ConsumerRequestReading | null> {
      const r = await guestCall(API.request, { method: "GET" });
      if (!r || !r.ok) return null;
      // NESTED key: `request`.
      const req = (r.body as {
        request?: {
          state?: unknown;
          deliveryState?: unknown;
          quoteStatus?: unknown;
          totalCents?: unknown;
          lineItems?: unknown;
          paymentState?: unknown;
          driver?: unknown;
          recipientNotifiedAt?: unknown;
          recipientNotifiedTo?: unknown;
        };
      } | null)?.request;
      if (!req || typeof req.state !== "string") return null;
      const view: ConsumerRequestReading = {
        state: req.state,
        deliveryState: typeof req.deliveryState === "string" ? req.deliveryState : null,
        quoteStatus: typeof req.quoteStatus === "string" ? req.quoteStatus : "",
        totalCents: typeof req.totalCents === "number" ? req.totalCents : null,
        lineItems: quoteLineItemsFrom(req.lineItems),
        paymentState: typeof req.paymentState === "string" ? req.paymentState : null,
        driver: req.driver && typeof req.driver === "object" &&
          typeof (req.driver as any).name === "string"
          ? { name: (req.driver as any).name,
              portraitUrl: typeof (req.driver as any).portraitUrl === "string"
                ? (req.driver as any).portraitUrl : null }
          : null,
      };
      /* A recipient bearer token must never reach the sender's adapter, so
         there is nothing here to copy across even if the server regressed. */
      if (typeof req.recipientNotifiedAt === "string" && req.recipientNotifiedAt !== "") {
        view.recipientNotifiedAt = req.recipientNotifiedAt;
        if (typeof req.recipientNotifiedTo === "string") {
          view.recipientNotifiedTo = req.recipientNotifiedTo;
        }
      }
      return view;
    },
  };
}
