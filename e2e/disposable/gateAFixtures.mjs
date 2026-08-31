/**
 * ONE canonical Gate A fixture builder, shared by every disposable suite.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * Before Gate A, a test fixture could `insert into couranr_payment_obligations`
 * with an amount and a policy version and nothing else, because commercial
 * identity lived on the mutable request row. Gate A moved it onto an immutable
 * `couranr_quote_versions` row and made every downstream record point at the
 * SAME quote:
 *
 *     request.current_quote_version_id
 *       = obligation.quote_version_id
 *       = service_plan.quote_version_id
 *       = delivery.quote_version_id
 *
 * Two invariants enforce it and are what turned six suites red:
 *
 *   couranr_dr_quote_identity_completeness_chk — a request whose quote_status
 *     is anything but 'not_quoted' MUST carry current_quote_version_id;
 *   payment_obligation_quote_mismatch (CR409, from the BEFORE INSERT OR UPDATE
 *     trigger couranr_po_quote_invariant_trg) — the obligation's payer, policy,
 *     amount and currency must equal its quote's, and its quote must belong to
 *     its request.
 *
 * Every one of those six failures happened in FIXTURE SETUP, never in the
 * behaviour under test. The fixtures were writing rows the current data model
 * does not permit. The fix is to build the lineage, not to loosen the rule:
 * nothing here drops a constraint, disables a trigger, nulls a pointer or
 * writes a fabricated quote id.
 *
 * ---------------------------------------------------------------------------
 * HOW IT BUILDS THE LINEAGE
 * ---------------------------------------------------------------------------
 *
 * Through the CURRENT canonical named commands, in the order the product runs
 * them, rather than by hand-assembling rows that happen to satisfy the checks:
 *
 *   couranr_create_delivery_request_draft      draft + quote #1  (version 1)
 *   couranr_submit_delivery_request_v2         -> pending_couranr_review
 *   couranr_accept_delivery_request_as_quoted  -> confirmed
 *   couranr_create_payment_obligation          obligation on the current quote
 *   [patch payment_state]                      -> authorized
 *   couranr_mark_delivery_ready                -> readiness ready
 *   couranr_confirm_service_plan               plan on the same quote
 *   couranr_begin_payment_capture              -> capture_pending
 *   [patch payment_state]                      -> captured
 *   couranr_create_delivery_from_capture       delivery on the same quote
 *
 * The two `[patch payment_state]` steps are direct UPDATEs and are deliberate.
 * Gate A freezes an obligation's COMMERCIAL IDENTITY (request, business, payer,
 * quote, policy, amount, currency, provider) and says nothing about its payment
 * lifecycle; couranr_po_quote_invariant_trg still fires on those UPDATEs and
 * still re-validates the quote match, so this is the state machine moving, not
 * the invariant being bypassed. The alternative — driving a real Stripe
 * PaymentIntent through couranr_apply_payment_intent_state — is what
 * releaseRoute.mjs already does for the behaviour it tests; making every
 * fixture do it would add a Stripe double to suites that have no payment
 * subject at all.
 *
 * ---------------------------------------------------------------------------
 * TWO TRANSPORTS, ONE CHAIN
 * ---------------------------------------------------------------------------
 *
 * Five of the six suites talk to the disposable cluster through `psql`. The
 * sixth (`test:acceptance`) runs `e2e/phase8Acceptance.mjs`, which is a
 * supabase-js client over PostgREST because it must also be able to run against
 * a hosted project. Rather than write the chain twice, the chain is written
 * once against a tiny transport interface and each caller supplies the adapter.
 */
import crypto from "node:crypto";

/* --------------------------------------------------------------- literals */

const esc = (s) => String(s).replace(/'/g, "''");

/**
 * Named-notation argument with an EXPLICIT cast.
 *
 * Without the cast a `null` argument is `unknown`, and PostgreSQL cannot always
 * resolve which overload was meant; with a jsonb argument an uncast literal is
 * resolvable but a `text[]` one is not. Casting every argument from the
 * signature map removes the whole class rather than the instances that happened
 * to fail.
 */
function sqlLit(value, type) {
  if (value === null || value === undefined) return `null::${type}`;
  if (type === "jsonb") return `'${esc(JSON.stringify(value))}'::jsonb`;
  if (type === "text[]") {
    return `array[${value.map((v) => `'${esc(v)}'`).join(",")}]::text[]`;
  }
  if (type === "boolean") return value ? "true" : "false";
  if (type === "integer" || type === "numeric") return `(${String(value)})::${type}`;
  return `'${esc(String(value))}'::${type}`;
}

/* ------------------------------------------------------- command signatures */

/**
 * Parameter types, read from the migration that defines each function, not
 * guessed. They exist so the psql transport can cast; the supabase-js transport
 * ignores them and passes the same JS values as JSON.
 */
export const COMMAND_SIGNATURES = {
  couranr_create_delivery_request_draft: {
    p_business_account_id: "uuid", p_created_by: "uuid", p_idempotency_key: "text",
    p_source: "text", p_readiness_state: "text", p_payer_type: "text",
    p_recipient_name: "text", p_recipient_phone: "text", p_recipient_email: "text",
    p_loaded_miles: "numeric", p_weight_lb: "numeric", p_additional_stops: "integer",
    p_service_level: "text", p_signature_required: "boolean", p_proof_method: "text",
    p_pickup_address: "jsonb", p_dropoff_address: "jsonb", p_overnight_requested: "boolean",
    p_quote_status: "text", p_pricing_policy_version: "text",
    p_delivery_subtotal_cents: "integer", p_included_loaded_miles: "integer",
    p_billable_loaded_miles: "numeric", p_quote_line_items: "jsonb",
    p_review_reasons: "jsonb",
  },
  couranr_submit_delivery_request_v2: {
    p_request_id: "uuid", p_business_account_id: "uuid", p_expected_version: "integer",
    p_actor_user_id: "uuid", p_acknowledged: "boolean",
  },
  couranr_accept_delivery_request_as_quoted: {
    p_request_id: "uuid", p_business_account_id: "uuid", p_expected_version: "integer",
    p_actor_user_id: "uuid",
  },
  couranr_create_payment_obligation: {
    p_request_id: "uuid", p_business_account_id: "uuid", p_idempotency_key: "text",
  },
  couranr_mark_delivery_ready: {
    p_request_id: "uuid", p_business_account_id: "uuid", p_expected_version: "integer",
    p_actor_user_id: "uuid",
  },
  couranr_confirm_service_plan: {
    p_request_id: "uuid", p_expected_version: "integer", p_actor_user_id: "uuid",
    p_pickup_start: "timestamptz", p_pickup_end: "timestamptz", p_timezone: "text",
    p_vehicle_id: "uuid", p_vehicle_requirement: "jsonb",
  },
  couranr_begin_payment_capture: {
    p_request_id: "uuid", p_actor_user_id: "uuid",
  },
  couranr_create_delivery_from_capture: {
    p_request_id: "uuid",
  },
};

/* ------------------------------------------------------------- transports */

/**
 * psql transport. `psql` is `e2e/disposable/up.mjs`'s exported helper, which
 * runs one statement per connection with ON_ERROR_STOP=1.
 *
 * A composite-returning function used in FROM expands to exactly one row, so
 * `row_to_json(t)` yields the whole record in one line of `-tA` output. Reading
 * a single named column instead would need a second call per field, and each
 * call is its own transaction.
 */
export function psqlTransport(psql) {
  const one = (sql) => psql(sql).trim();
  return {
    kind: "psql",
    async rpc(name, args) {
      const sig = COMMAND_SIGNATURES[name];
      if (!sig) throw new Error(`gateAFixtures: no signature for ${name}`);
      const list = Object.entries(args)
        .map(([k, v]) => `${k} := ${sqlLit(v, sig[k] || "text")}`)
        .join(", ");
      const out = one(`select row_to_json(t) from public.${name}(${list}) t`);
      return out === "" ? null : JSON.parse(out);
    },
    async patchObligation(obligationId, patch) {
      const sets = Object.entries(patch)
        .map(([k, v]) => `${k} = ${v === null ? "null" : OBLIGATION_PATCH_SQL[k](v)}`)
        .join(", ");
      one(
        `update public.couranr_payment_obligations
            set ${sets}, updated_at = now()
          where id = '${esc(obligationId)}'::uuid`,
      );
    },
    async obligationAmountCents(obligationId) {
      return Number(
        one(`select amount_cents from public.couranr_payment_obligations
              where id = '${esc(obligationId)}'::uuid`),
      );
    },
    async integrityIssues() {
      const out = one(
        `select coalesce(string_agg(issue_code, ',' order by issue_code), '')
           from public.couranr_foundation_integrity()`,
      );
      return out === "" ? [] : out.split(",");
    },
  };
}

/**
 * The columns the fixture chain is allowed to patch, and how each is written.
 * Deliberately a closed list: it is the payment LIFECYCLE, and it contains no
 * commercial-identity column. Adding `quote_version_id` or `amount_cents` here
 * would be exactly the Gate A weakening this file refuses to do.
 *
 * `version` is deliberately NOT bumped. It is the obligation's optimistic-
 * concurrency generation, and a fixture arriving in a state is not a command
 * having run: releaseAuthorization.mjs asserts that
 * couranr_begin_payment_release is what moves it 1 -> 2, and a fixture that
 * quietly consumed generation 1 would make that assertion prove nothing while
 * still passing.
 */
const OBLIGATION_PATCH_SQL = {
  payment_state: (v) => `'${esc(v)}'::text`,
  provider_payment_intent_id: (v) => `'${esc(v)}'::text`,
  authorized_at: () => "now()",
  captured_at: () => "now()",
  captured_amount_cents: (v) => `(${Number(v)})::integer`,
  cancelled_at: () => "now()",
  // couranr_po_failed_stamp_chk (20260801120000) is
  // `payment_state <> 'failed' or failed_at is not null`, so a failed hold that
  // does not say when it failed is not writable at all.
  failed_at: () => "now()",
};

/**
 * supabase-js transport, for the harnesses that must also be able to point at a
 * hosted project. `sb` is a service-role client; the canonical commands are
 * granted to service_role only.
 */
export function supabaseTransport(sb) {
  const unwrap = (r, what) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };
  return {
    kind: "supabase",
    async rpc(name, args) {
      return unwrap(await sb.rpc(name, args), name);
    },
    async patchObligation(obligationId, patch) {
      const row = { ...patch, updated_at: new Date().toISOString() };
      for (const k of ["authorized_at", "captured_at", "cancelled_at", "failed_at"]) {
        if (k in row && row[k] !== null) row[k] = new Date().toISOString();
      }
      unwrap(
        await sb.from("couranr_payment_obligations").update(row).eq("id", obligationId).select("id"),
        "patch obligation",
      );
    },
    async obligationAmountCents(obligationId) {
      const row = unwrap(
        await sb.from("couranr_payment_obligations").select("amount_cents").eq("id", obligationId).single(),
        "obligation amount",
      );
      return row.amount_cents;
    },
    async integrityIssues() {
      const rows = unwrap(await sb.rpc("couranr_foundation_integrity"), "integrity probe");
      return (rows || []).map((r) => r.issue_code);
    },
  };
}

/* ------------------------------------------------------------- the chain */

const uuid = () => crypto.randomUUID();
const shortId = () => crypto.randomUUID().slice(0, 8);

/** A Stripe-shaped id. Fixtures that need a REAL intent pass their own. */
export const syntheticIntentId = () => `pi_${uuid().replace(/-/g, "").slice(0, 20)}`;

/**
 * Defaults chosen so the chain is legal end to end: `additional_stops` is 0
 * because M6 refuses a new request with any other value, and `maxPayloadLb`
 * exceeds `weightLb` because couranr_confirm_service_plan checks the vehicle
 * against the QUOTE's shipment snapshot.
 */
export const FIXTURE_DEFAULTS = {
  source: "merchant_portal",
  readinessState: "not_confirmed",
  payerType: "merchant",
  recipientName: "Gate A Fixture",
  recipientPhone: "+15715550123",
  recipientEmail: "fixture@couranr.invalid",
  loadedMiles: 5,
  weightLb: 20,
  serviceLevel: "standard",
  signatureRequired: false,
  proofMethod: "photo_or_pin",
  pickupAddress: { line1: "12 Test St", city: "Stafford", region: "VA", postalCode: "22554" },
  dropoffAddress: { line1: "9 Drop Ct", city: "Woodbridge", region: "VA", postalCode: "22191" },
  subtotalCents: 2299,
  pricingPolicyVersion: "disposable",
  includedLoadedMiles: 3,
  timezone: "America/New_York",
  vehicleRequirement: { vehicleClass: "van", maxPayloadLb: 2000 },
};

/**
 * A request WITH its first immutable quote, carried as far through review as
 * `upTo` asks.
 *
 *   draft       the draft and its quote        request_state draft,
 *                                              review_state not_required
 *   submitted   + couranr_submit_delivery_request_v2
 *                                              pending_couranr_review, pending
 *   confirmed   + couranr_accept_delivery_request_as_quoted   (default)
 *                                              confirmed, accepted_as_quoted
 *
 * `upTo` is deliberately NOT named `stopAfter`. seedCanonicalDeliveryChain
 * forwards its whole options object to this function, so one shared key would
 * mean a chain asked to stop at its `obligation` depth silently stopping at a
 * draft here — a fixture that looks seeded and is not. Two names, no collision.
 *
 * review_state is never chosen by a caller: the commands write it (draft
 * not_required, submit pending, accept accepted_as_quoted). That is the point —
 * the four values the list screens facet on are the ones the state machine
 * actually produces, rather than whatever an INSERT felt like claiming.
 *
 * Line items are built from the subtotal rather than passed alongside it:
 * couranr_quote_line_items_total must equal subtotal_cents exactly, and a
 * fixture that lets the two drift raises CR422 quote_subtotal_mismatch — a
 * confusing failure a long way from its cause.
 */
const REVIEW_DEPTHS = ["draft", "submitted", "confirmed"];

export async function seedCanonicalQuotedRequest(t, opts) {
  const o = { ...FIXTURE_DEFAULTS, ...opts };
  if (!o.businessId || !o.actorUserId) {
    throw new Error("seedCanonicalQuotedRequest: businessId and actorUserId are required");
  }
  const upTo = o.upTo || "confirmed";
  if (!REVIEW_DEPTHS.includes(upTo)) {
    throw new Error(`seedCanonicalQuotedRequest: unknown upTo ${upTo}`);
  }
  const marker = o.marker || `gafx-${shortId()}`;

  const shape = (row) => ({
    requestId: row.id,
    quoteVersionId: row.current_quote_version_id,
    version: row.version,
    businessId: o.businessId,
    actorUserId: o.actorUserId,
    subtotalCents: o.subtotalCents,
    pricingPolicyVersion: o.pricingPolicyVersion,
    requestState: row.request_state,
    reviewState: row.review_state,
    readinessState: row.readiness_state,
    marker,
  });

  const draft = await t.rpc("couranr_create_delivery_request_draft", {
    p_business_account_id: o.businessId,
    p_created_by: o.actorUserId,
    p_idempotency_key: o.idempotencyKey || `${marker}-${uuid()}`,
    p_source: o.source,
    p_readiness_state: o.readinessState,
    p_payer_type: o.payerType,
    p_recipient_name: o.recipientName,
    p_recipient_phone: o.recipientPhone,
    p_recipient_email: o.recipientEmail,
    p_loaded_miles: o.loadedMiles,
    p_weight_lb: o.weightLb,
    // M6: a new canonical request is single-destination by contract.
    p_additional_stops: 0,
    p_service_level: o.serviceLevel,
    p_signature_required: o.signatureRequired,
    p_proof_method: o.proofMethod,
    p_pickup_address: o.pickupAddress,
    p_dropoff_address: o.dropoffAddress,
    p_overnight_requested: false,
    p_quote_status: "estimated",
    p_pricing_policy_version: o.pricingPolicyVersion,
    p_delivery_subtotal_cents: o.subtotalCents,
    p_included_loaded_miles: o.includedLoadedMiles,
    p_billable_loaded_miles: o.loadedMiles,
    p_quote_line_items: [
      { code: "delivery_base", label: "Delivery", amountCents: o.subtotalCents },
    ],
    p_review_reasons: [],
  });

  if (upTo === "draft") return shape(draft);

  const submitted = await t.rpc("couranr_submit_delivery_request_v2", {
    p_request_id: draft.id,
    p_business_account_id: o.businessId,
    p_expected_version: draft.version,
    p_actor_user_id: o.actorUserId,
    // A merchant-payer request cannot be accepted without this: the acceptance
    // command reads the submit event and refuses CR412 without an acknowledged
    // quote id that still matches.
    p_acknowledged: true,
  });

  if (upTo === "submitted") return shape(submitted);

  const accepted = await t.rpc("couranr_accept_delivery_request_as_quoted", {
    p_request_id: submitted.id,
    p_business_account_id: o.businessId,
    p_expected_version: submitted.version,
    p_actor_user_id: o.reviewerUserId || o.actorUserId,
  });

  return shape(accepted);
}

/**
 * The obligation for `request.current_quote_version_id`, advanced to
 * `paymentState`.
 *
 * `not_started` is what the command itself produces. Everything above it is the
 * payment state machine moving; see the note at the top of this file for why
 * that is a patch rather than a Stripe round trip.
 */
export async function seedCanonicalPaymentObligation(t, request, opts = {}) {
  const state = opts.paymentState || "authorized";
  const obligation = await t.rpc("couranr_create_payment_obligation", {
    p_request_id: request.requestId,
    p_business_account_id: request.businessId,
    p_idempotency_key: opts.idempotencyKey || `${request.marker}-po-${uuid()}`,
  });

  const NEEDS_AUTHORIZATION = ["authorized", "capture_pending", "captured", "refunded"];
  // `withIntent: false` is authoritative, and is checked BEFORE an explicit
  // intentId. The other order reads the same and is a trap: a caller asking for
  // "no intent" while a chain forwarded an id would silently get one, and the
  // fixture would prove the opposite of what it was asked for.
  //
  // Every state past `not_started` carries an intent, not only the authorized
  // family: a hold that FAILED still had a PaymentIntent, and the fixtures this
  // replaces all wrote one. `couranr_po_intent_uniq` is satisfied because the
  // id is uuid-derived.
  const intentId =
    opts.withIntent === false
      ? null
      : opts.intentId || (state === "not_started" ? null : syntheticIntentId());

  if (state !== "not_started") {
    const patch = { payment_state: state };
    if (intentId) patch.provider_payment_intent_id = intentId;
    // couranr_po_authorized_stamp_chk: authorized_at is required from
    // `authorized` onward, not only while the state IS authorized.
    if (NEEDS_AUTHORIZATION.includes(state)) patch.authorized_at = true;
    // couranr_po_captured_stamp_chk / couranr_po_captured_amount_chk.
    if (state === "captured" || state === "refunded") {
      patch.captured_at = true;
      patch.captured_amount_cents = await t.obligationAmountCents(obligation.id);
    }
    if (state === "cancelled") patch.cancelled_at = true;
    if (state === "failed") patch.failed_at = true;
    await t.patchObligation(obligation.id, patch);
  }

  return { obligationId: obligation.id, intentId, paymentState: state, amountCents: obligation.amount_cents };
}

/**
 * Readiness `ready`, which the capture path requires. Bumps request.version.
 *
 * Through `couranr_mark_delivery_ready`, the NAMED command, not through the
 * `couranr_apply_readiness` implementation it wraps. 20260801090000 says in as
 * many words that p_to and p_from are supplied by the wrappers and never by a
 * caller — the wrappers are what carry the grant and what fix the allowed
 * source states. A fixture choosing its own transition would be exercising a
 * transition the product cannot make.
 */
export async function markCanonicalRequestReady(t, request) {
  const row = await t.rpc("couranr_mark_delivery_ready", {
    p_request_id: request.requestId,
    p_business_account_id: request.businessId,
    p_expected_version: request.version,
    p_actor_user_id: request.actorUserId,
  });
  request.version = row.version;
  return request;
}

/** The confirmed service plan, on the same quote as the obligation. */
export async function seedCanonicalServicePlan(t, request, opts = {}) {
  const start = opts.pickupStart || new Date(Date.now() + 3600e3).toISOString();
  const end = opts.pickupEnd || new Date(Date.now() + 7200e3).toISOString();
  const plan = await t.rpc("couranr_confirm_service_plan", {
    p_request_id: request.requestId,
    p_expected_version: request.version,
    p_actor_user_id: request.actorUserId,
    p_pickup_start: start,
    p_pickup_end: end,
    p_timezone: opts.timezone || FIXTURE_DEFAULTS.timezone,
    p_vehicle_id: opts.vehicleId || null,
    p_vehicle_requirement: opts.vehicleRequirement || FIXTURE_DEFAULTS.vehicleRequirement,
  });
  return { planId: plan.id, quoteVersionId: plan.quote_version_id };
}

/**
 * The delivery, built by the canonical conversion command from the captured
 * obligation — so its commercial snapshot comes from the quote rather than from
 * whatever a fixture felt like typing.
 *
 * Capture is two steps because the product's is: `couranr_begin_payment_capture`
 * moves authorized -> capture_pending and is what the operator triggers, and the
 * provider confirming the charge is what makes it `captured`.
 */
export async function beginCanonicalCapture(t, request) {
  const ob = await t.rpc("couranr_begin_payment_capture", {
    p_request_id: request.requestId,
    p_actor_user_id: request.actorUserId,
  });
  return { obligationId: ob.id, paymentState: ob.payment_state };
}

export async function seedCanonicalDelivery(t, request, obligation) {
  await t.patchObligation(obligation.obligationId, {
    payment_state: "captured",
    captured_at: true,
    captured_amount_cents: await t.obligationAmountCents(obligation.obligationId),
  });
  const delivery = await t.rpc("couranr_create_delivery_from_capture", {
    p_request_id: request.requestId,
  });
  return { deliveryId: delivery.id, quoteVersionId: delivery.quote_version_id };
}

/**
 * The whole chain: request -> quote -> obligation -> plan -> delivery, every
 * link on the same immutable quote.
 *
 * `stopAfter` exists because the suites need different depths and EVERY depth
 * must leave the graph clean under couranr_foundation_integrity(). Stopping at
 * a `captured` obligation with no delivery is the one shape that is NOT clean —
 * the probe reports `captured_without_delivery` — which is why `captured` is
 * not a stop point and `delivery` is.
 *
 *   obligation       confirmed request + authorized obligation
 *   plan             + readiness ready + confirmed service plan
 *   capture_pending  + couranr_begin_payment_capture
 *   delivery         + captured + the converted delivery   (default)
 */
const CHAIN_STOPS = ["obligation", "plan", "capture_pending", "delivery"];

export async function seedCanonicalDeliveryChain(t, opts = {}) {
  const stopAfter = opts.stopAfter || "delivery";
  if (!CHAIN_STOPS.includes(stopAfter)) {
    throw new Error(`seedCanonicalDeliveryChain: unknown stopAfter ${stopAfter}`);
  }
  const depth = CHAIN_STOPS.indexOf(stopAfter);

  const request = await seedCanonicalQuotedRequest(t, { ...opts, upTo: "confirmed" });
  const obligation = await seedCanonicalPaymentObligation(t, request, {
    paymentState: "authorized",
    intentId: opts.intentId,
    withIntent: opts.withIntent,
  });
  const out = {
    businessId: request.businessId,
    actorUserId: request.actorUserId,
    requestId: request.requestId,
    quoteVersionId: request.quoteVersionId,
    obligationId: obligation.obligationId,
    intentId: obligation.intentId,
    planId: null,
    deliveryId: null,
    marker: request.marker,
    subtotalCents: request.subtotalCents,
    paymentState: "authorized",
    get version() { return request.version; },
  };
  if (depth < 1) return out;

  await markCanonicalRequestReady(t, request);
  const plan = await seedCanonicalServicePlan(t, request, opts);
  out.planId = plan.planId;
  if (depth < 2) return out;

  const begun = await beginCanonicalCapture(t, request);
  out.paymentState = begun.paymentState;
  if (depth < 3) return out;

  const delivery = await seedCanonicalDelivery(t, request, obligation);
  out.deliveryId = delivery.deliveryId;
  out.paymentState = "captured";
  return out;
}

/**
 * The positive control on the fixtures themselves.
 *
 * couranr_foundation_integrity() is the permanent Gate A probe. A fixture that
 * merely got PAST the triggers can still leave the graph inconsistent in ways
 * no single trigger sees — a plan pointing at a cancelled obligation, a
 * captured obligation with no delivery. Asserting the probe returns nothing is
 * how these fixtures are proved legal rather than just accepted.
 */
export async function gateAIntegrityIssues(t) {
  return t.integrityIssues();
}
