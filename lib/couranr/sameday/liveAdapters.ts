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
  QuoteReading,
  SameDayAdapters,
  SubmitOutcome,
} from "./adapters";

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
} as const;

/** The two review reasons that are about the TRIP rather than the shipment. */
const ROUTE_REVIEW_REASONS = ["route_needs_review", "market_needs_review"] as const;

const NOTES = {
  serviceDown: "Couranr could not reach the delivery service. Try again.",
  bothAddresses: "Enter both a pickup and a destination.",
  chooseSuggestions: "Choose both addresses from the suggestions.",
  weightRequired: "Enter the weight, or choose the honest range.",
  descriptionRequired: "Tell Couranr what the driver should look for at pickup.",
  descriptionTooLong: "Keep the pickup description to 1,000 characters or fewer.",
  packageCountInvalid: "Package count must be a whole number from 1 to 9,999, or left blank.",
  contactRequired: "Add your mobile number or email on the review step, then check the price.",
  review: "Couranr will review this delivery and confirm the price with you.",
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
  if (!contact.phone && !contact.email) {
    return { ok: false, note: NOTES.contactRequired };
  }

  const description =
    typeof ship?.description === "string" && ship.description.trim() !== ""
      ? ship.description.trim()
      : null;
  if (!description) return { ok: false, note: NOTES.descriptionRequired };
  if (description.length > 1000) return { ok: false, note: NOTES.descriptionTooLong };

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
      shipment: {
        description,
        weightLb,
        weightBand,
        // Absent means "unknown" server-side too; sent explicitly for honesty.
        restrictedClass:
          typeof ship?.restrictedClass === "string" && ship.restrictedClass !== ""
            ? ship.restrictedClass
            : "unknown",
        signatureRequired: ship?.signatureRequired === true,
        overnightRequested: ship?.overnightRequested === true,
      },
      // V0 consumer funnel: ASAP only. The server fixes it regardless.
      timing: { intent: "asap" },
    },
  };
}

/** The estimate payload, as the route nests it under `estimate`. */
type EstimateLike = {
  requestId?: unknown;
  quoteStatus?: unknown;
  pickupManifestVersion?: unknown;
  totalCents?: unknown;
  reviewReasons?: unknown;
  quoteVersionId?: unknown;
  expiresAt?: unknown;
};

/**
 * quoteStatus -> QuoteReading. `estimated` is the only payable answer;
 * `manual_review_required` keeps the existing review-needed presentation;
 * everything else (`invalid` = policy-prohibited, `not_quoted`) refuses.
 */
export function quoteReadingFromEstimate(est: EstimateLike): QuoteReading {
  const quoteStatus = typeof est.quoteStatus === "string" ? est.quoteStatus : "";
  const requestId = typeof est.requestId === "string" ? est.requestId : "";
  if (quoteStatus === "estimated" && typeof est.totalCents === "number" && requestId) {
    return {
      state: "live-available",
      totalCents: est.totalCents,
      quoteVersionId: typeof est.quoteVersionId === "string" ? est.quoteVersionId : null,
      requestId,
      expiresAt: typeof est.expiresAt === "string" ? est.expiresAt : null,
    };
  }
  if (quoteStatus === "manual_review_required") {
    return { state: "manual-review", note: NOTES.review };
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
    async searchAddress(query: string): Promise<AddressSuggestion[]> {
      const q = query.trim();
      if (q.length < 2) return [];
      const r = await guestCall(`${API.places}?query=${encodeURIComponent(q)}`, {
        method: "GET",
      });
      if (!r || !r.ok) return [];
      // NESTED key: `suggestions`.
      const raw = (r.body as { suggestions?: unknown } | null)?.suggestions;
      if (!Array.isArray(raw)) return [];
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
      return out;
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

    async submitRequest(): Promise<SubmitOutcome> {
      const r = await guestCall(API.submit, { method: "POST" });
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
          quoteStatus?: unknown;
          totalCents?: unknown;
          paymentState?: unknown;
          trackingToken?: unknown;
        };
      } | null)?.request;
      if (!req || typeof req.state !== "string") return null;
      const view: ConsumerRequestReading = {
        state: req.state,
        quoteStatus: typeof req.quoteStatus === "string" ? req.quoteStatus : "",
        totalCents: typeof req.totalCents === "number" ? req.totalCents : null,
        paymentState: typeof req.paymentState === "string" ? req.paymentState : null,
      };
      if (typeof req.trackingToken === "string" && req.trackingToken !== "") {
        view.trackingToken = req.trackingToken;
      }
      return view;
    },
  };
}
