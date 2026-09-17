import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_VOCABULARY,
  DEFAULT_FILTERS,
  UNRECOGNISED_KEY,
  aggregateOperationsAnalytics,
  aggregateUnmetDemand,
  attributeCause,
  bucketize,
  classifyMarket,
  distanceBand,
  parseFilters,
  type AnalyticsSource,
  type RequestRow,
  type TerminalEventRow,
  type UnmetDemandSource,
} from "@/lib/couranr/operations/analytics";
import { CAUSE_LABELS, DECLINE_REASON_LABELS } from "@/lib/couranr/operations/analyticsTypes";

const ROOT = path.resolve(__dirname, "..");
const AGGREGATION_FILE = readFileSync(
  path.join(ROOT, "lib/couranr/operations/analytics.ts"),
  "utf8"
);
/**
 * Comments stripped before scanning. The module's own documentation names the
 * columns it deliberately does NOT select, and a scan that read prose as code
 * would flag the very sentence promising the opposite.
 */
const AGGREGATION_SOURCE = AGGREGATION_FILE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  ""
);

const NOW = "2026-09-17T12:00:00.000Z";
const ALL: typeof DEFAULT_FILTERS = { days: null, market: null, category: null, payer: null };

const uuid = (n: number) =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

/* =====================================================================
 * 1. THE PRIVACY CONSTRAINT, AS A STRUCTURAL TEST
 *
 * OPS-013: "No message bodies, full addresses, gate codes, phone numbers,
 * proof URLs, or card data in analytics."
 *
 * A careful author is not a control — the next author is not this one. So the
 * poison below is pushed through the REAL aggregation (the same functions the
 * route calls; nothing is re-implemented here) and the entire serialized
 * output is searched for it.
 *
 * Two classes of poison, deliberately:
 *   - Fields no projection selects, present on the row anyway. This catches an
 *     object spread, a `...row`, or a future author adding the column back.
 *   - Fields the aggregation DOES read and group by. These are CHECK-
 *     constrained columns, so the values below cannot occur in production —
 *     but `bucketize` refuses any key outside the declared vocabulary, and
 *     this is what proves that refusal is real rather than decorative.
 * ===================================================================== */

const POISON = {
  messageBody: "Hi, please just leave it with the neighbour at number 12, thanks a lot",
  streetAddress: "1450 Garrisonville Road Apartment 7B",
  gateCode: "#4417*",
  phone: "+1 540 555 0147",
  proofUrl:
    "https://example.supabase.co/storage/v1/object/sign/delivery-photos/abc.jpg?token=eyJhbGciOiJIUzI1",
  cardNumber: "4242424242424242",
} as const;

const POISON_VALUES = Object.values(POISON);

/** Every field a careless author might reach for, all of them poisoned. */
const CONTAMINANTS = {
  // Not selected by any projection in the aggregation module.
  pickup_address: {
    line1: POISON.streetAddress,
    line2: "Apartment 7B",
    instructions: POISON.gateCode,
    formattedAddress: POISON.streetAddress,
    postalCode: "22554",
    latitude: 38.4220987,
    longitude: -77.4083321,
  },
  dropoff_address: { line1: POISON.streetAddress, instructions: POISON.gateCode },
  recipient: { name: "Dana Okonkwo", phone: POISON.phone, email: "dana@example.com" },
  recipient_phone: POISON.phone,
  recipient_email: "dana@example.com",
  consumer_contact_snapshot: { phone: POISON.phone, email: "dana@example.com" },
  normalized_request_payload: { consumerDescription: POISON.messageBody },
  pickup_manifest: { handlingNotes: POISON.messageBody },
  quote_line_items: [{ label: POISON.messageBody }],
  metadata: {
    internalNote: POISON.messageBody,
    merchantMessage: POISON.messageBody,
    reason: POISON.messageBody,
    gateCode: POISON.gateCode,
  },
  detail: { payment_method: { card: { number: POISON.cardNumber } } },
  card_number: POISON.cardNumber,
  note: POISON.messageBody,
  summary: POISON.messageBody,
  details: POISON.messageBody,
  storage_bucket: "delivery-photos",
  storage_object_path: "deliveries/abc/dropoff.jpg",
  signed_url: POISON.proofUrl,
  proof_url: POISON.proofUrl,
  display_name: "Marcus Bell",
  contact_phone: POISON.phone,
  captured_latitude: 38.4220987,
  captured_longitude: -77.4083321,
} as const;

function poisonedRequest(over: Partial<RequestRow> = {}): any {
  return {
    ...CONTAMINANTS,
    id: uuid(1),
    business_account_id: uuid(90),
    created_at: "2026-09-10T10:00:00.000Z",
    submitted_at: "2026-09-10T10:05:00.000Z",
    request_state: "declined",
    review_state: "declined",
    /* The second poison class: CHECK-constrained columns the aggregation
       groups by, carrying values the vocabulary does not declare. */
    service_area_review_state: POISON.gateCode,
    quote_status: POISON.phone,
    payer_type: "merchant",
    requester_kind: "business",
    service_level: "standard",
    weight_band: POISON.gateCode,
    restricted_class: POISON.phone,
    loaded_miles: 4.2,
    billable_loaded_miles: 4.2,
    review_reasons: [POISON.messageBody, "route_needs_review"],
    timing_review_reasons: [POISON.gateCode],
    // The three verified address fields the classifier consumes.
    pickup_city: POISON.streetAddress,
    pickup_region: POISON.gateCode,
    pickup_country: "US",
    ...over,
  };
}

function poisonedOperationsSource(): AnalyticsSource {
  return {
    requests: [poisonedRequest()],
    deliveries: [
      {
        ...CONTAMINANTS,
        id: uuid(2),
        request_id: uuid(1),
        business_account_id: uuid(90),
        created_at: "2026-09-10T11:00:00.000Z",
        fulfillment_state: "delivered",
        service_level: "standard",
        proof_method: POISON.gateCode,
        plan_source: "automatic",
        promotional_credit_cents: 500,
        standard_quote_cents: 1299,
      },
    ] as any,
    obligations: [
      {
        ...CONTAMINANTS,
        id: uuid(3),
        request_id: uuid(1),
        created_at: "2026-09-10T11:05:00.000Z",
        payer_type: POISON.cardNumber,
        payment_state: "captured",
        amount_cents: 1299,
        captured_at: "2026-09-10T12:00:00.000Z",
        captured_amount_cents: 1299,
        refunded_at: null,
        refunded_amount_cents: null,
      },
    ] as any,
    proofs: [
      {
        ...CONTAMINANTS,
        delivery_id: uuid(2),
        proof_stage: POISON.gateCode,
        proof_type: POISON.proofUrl,
        created_at: "2026-09-10T12:30:00.000Z",
      },
    ] as any,
    assignments: [
      {
        ...CONTAMINANTS,
        id: uuid(4),
        delivery_id: uuid(2),
        driver_id: uuid(5),
        assignment_state: POISON.phone,
        created_at: "2026-09-10T11:10:00.000Z",
      },
    ] as any,
    drivers: [{ ...CONTAMINANTS, id: uuid(5), driver_state: "active", active: true }] as any,
    incidents: [
      {
        ...CONTAMINANTS,
        id: uuid(6),
        incident_type: POISON.messageBody,
        incident_state: "reported",
        created_at: "2026-09-10T13:00:00.000Z",
      },
    ] as any,
    problemReports: [
      {
        ...CONTAMINANTS,
        id: uuid(7),
        problem_type: POISON.messageBody,
        report_state: "reported",
        created_at: "2026-09-10T13:30:00.000Z",
      },
    ] as any,
    conversations: [
      {
        ...CONTAMINANTS,
        id: uuid(8),
        kind: POISON.messageBody,
        status: "open",
        due_state: "breached",
        created_at: "2026-09-10T14:00:00.000Z",
      },
    ] as any,
    workspaces: [
      { ...CONTAMINANTS, business_account_id: uuid(90), business_category: POISON.streetAddress },
    ] as any,
    truncatedSources: [],
  };
}

function poisonedUnmetSource(): UnmetDemandSource {
  return {
    requests: [poisonedRequest()],
    terminalEvents: [
      {
        ...CONTAMINANTS,
        request_id: uuid(1),
        actor_type: "operations",
        command: "decline_delivery_request",
        created_at: "2026-09-10T15:00:00.000Z",
        reason_code: POISON.messageBody,
      },
    ] as any,
    workspaces: [
      { ...CONTAMINANTS, business_account_id: uuid(90), business_category: POISON.streetAddress },
    ] as any,
    truncatedSources: [],
  };
}

describe("OPS-013 privacy constraint: nothing personal survives the aggregation", () => {
  it("proves the poison is actually present on the input rows", () => {
    /* A negative result is a claim about the query first and the data second.
       If the contaminants were not really on the rows, every assertion below
       would pass vacuously. */
    const input = JSON.stringify(poisonedOperationsSource());
    for (const value of POISON_VALUES) {
      expect(input, `poison ${value} is missing from the input`).toContain(value);
    }
  });

  it("emits no message body, address, gate code, phone number, proof URL or card number (OPS-013)", () => {
    const output = JSON.stringify(
      aggregateOperationsAnalytics(poisonedOperationsSource(), ALL, NOW)
    );
    for (const [name, value] of Object.entries(POISON)) {
      expect(output.includes(value), `OPS-013 output leaked the ${name}`).toBe(false);
    }
  });

  it("emits none of it on the unmet-demand tab either (OPS-014)", () => {
    const output = JSON.stringify(aggregateUnmetDemand(poisonedUnmetSource(), ALL, NOW));
    for (const [name, value] of Object.entries(POISON)) {
      expect(output.includes(value), `OPS-014 output leaked the ${name}`).toBe(false);
    }
  });

  it("leaks no fragment of a street address either, not only the whole string", () => {
    /* A leak does not have to be verbatim. These are the pieces of the address
       and the contact details that would still be personal on their own. */
    const fragments = [
      "Garrisonville", "Apartment", "22554", "38.4220987", "-77.4083321",
      "Dana Okonkwo", "dana@example.com", "Marcus Bell", "delivery-photos",
      "deliveries/abc/dropoff.jpg", "5550147", "neighbour",
    ];
    const outputs = [
      JSON.stringify(aggregateOperationsAnalytics(poisonedOperationsSource(), ALL, NOW)),
      JSON.stringify(aggregateUnmetDemand(poisonedUnmetSource(), ALL, NOW)),
    ].join("\n");
    for (const fragment of fragments) {
      expect(outputs.includes(fragment), `output leaked the fragment ${fragment}`).toBe(false);
    }
  });

  it("counts an unrecognised value rather than dropping or printing it", () => {
    /* Refusing a key must not silently lose the row: an understated total is a
       wrong measurement, which is the other half of the same promise. */
    const value = aggregateUnmetDemand(poisonedUnmetSource(), ALL, NOW);
    expect(value.universe.couldNotConfirm).toBe(1);
    expect(value.serviceArea.rows).toEqual([
      { key: UNRECOGNISED_KEY, label: "Unrecognised value (not shown)", count: 1 },
    ]);
    expect(value.quoteDisposition.rows[0].key).toBe(UNRECOGNISED_KEY);
    /* The one governed review reason on the row survives; the poisoned one is
       refused. Both are counted. */
    expect(value.reviewTriggers.rows.map((r) => r.key).sort()).toEqual([
      "route_needs_review",
      UNRECOGNISED_KEY,
    ]);
  });

  it("classifies a poisoned pickup address as outside the launch markets, never by name", () => {
    expect(classifyMarket({
      pickup_city: POISON.streetAddress,
      pickup_region: POISON.gateCode,
      pickup_country: "US",
    })).toBe("outside_launch_markets");
  });

  it("emits only UUIDs, ISO timestamps and closed-vocabulary keys as bucket keys", () => {
    const value = aggregateOperationsAnalytics(poisonedOperationsSource(), ALL, NOW);
    const keys = [
      ...value.markets.rows, ...value.categories.rows, ...value.payerMix.rows,
      ...value.requesterMix.rows, ...value.paidDeliveries.byFulfillmentState.rows,
      ...value.support.conversations.rows, ...value.support.problemReports.rows,
      ...value.support.incidents.rows, ...value.proof.byStage.rows,
      ...value.proof.byType.rows, ...value.driverUtilization.assignmentsByState.rows,
      ...value.driverUtilization.perDriver.rows,
    ].map((r) => r.key);

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const key of keys) {
      const ok = key === UNRECOGNISED_KEY || uuidRe.test(key) || /^[a-z0-9_|]+$/.test(key);
      expect(ok, `bucket key "${key}" is neither a UUID nor a closed-vocabulary key`).toBe(true);
    }
  });
});

describe("the projections themselves name no personal column", () => {
  /* Mechanism 1 of the privacy contract. The aggregation can only be as safe
     as what is fetched into it, and the poison test above cannot see the
     `.select()` strings at all — it is handed rows. This does. */
  /*
   * Collect the projection of EVERY `.select(...)`, including the ones whose
   * argument is a named constant rather than a literal.
   *
   * The first version of this scan only read literals written inside the
   * parentheses, so it silently skipped `REQUEST_SELECT` — the single largest
   * projection in the module and the one that touches the address. A negative
   * control caught it: re-adding a bare `pickup_address` to that constant left
   * the suite green. A gate that cannot fail is worse than no gate.
   */
  function literalsIn(text: string): string {
    return (text.match(/"[^"]*"/g) ?? []).map((t) => t.slice(1, -1)).join("");
  }

  /** Reads `.select(` to its balanced closing paren. A regex cannot do this
   *  reliably — the first attempt silently skipped every call whose argument
   *  was a bare identifier, which is exactly where the address projection is. */
  function selectArgs(src: string): string[] {
    const out: string[] = [];
    const needle = ".select(";
    for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
      let depth = 1;
      let j = i + needle.length;
      while (j < src.length && depth > 0) {
        if (src[j] === "(") depth += 1;
        else if (src[j] === ")") depth -= 1;
        j += 1;
      }
      out.push(src.slice(i + needle.length, j - 1).trim());
    }
    return out;
  }

  const SELECT_ARGS = selectArgs(AGGREGATION_SOURCE);

  const SELECTS = SELECT_ARGS.map((arg) => {
    if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
      // `.select(REQUEST_SELECT)` — resolve the constant to its own literals.
      const decl = AGGREGATION_SOURCE.match(
        new RegExp(`const\\s+${arg}\\s*=([\\s\\S]*?);`)
      );
      return decl ? literalsIn(decl[1]) : "";
    }
    return literalsIn(arg);
  });

  const FORBIDDEN_BARE = new Set([
    "pickup_address", "dropoff_address", "recipient", "recipient_name",
    "recipient_phone", "recipient_email", "consumer_contact_snapshot",
    "normalized_request_payload", "pickup_manifest", "preset_snapshot",
    "quote_line_items", "metadata", "detail", "note", "summary", "details",
    "storage_bucket", "storage_object_path", "evidence_sha256",
    "captured_latitude", "captured_longitude", "display_name", "contact_phone",
    "shipment", "route_origin_snapshot", "return_destination_snapshot",
    "reference", "idempotency_key", "provider_payment_intent_id",
    "*",
  ]);

  /** The only jsonb projections allowed, and the only keys they may read. */
  const ALLOWED_JSON = new Map<string, Set<string>>([
    ["pickup_address", new Set(["city", "region", "countryCode"])],
    ["metadata", new Set(["reasonCode"])],
  ]);

  it("finds the projections it is meant to police, including the named constants", () => {
    // A regex that matched nothing — or that skipped the biggest projection —
    // would make every assertion below vacuous. Both halves are asserted.
    expect(SELECTS.length).toBeGreaterThanOrEqual(12);
    const joined = SELECTS.join(",");
    expect(joined, "the delivery projection was not scanned").toContain("fulfillment_state");
    expect(joined, "the REQUEST_SELECT constant was not resolved").toContain(
      "service_area_review_state"
    );
    expect(joined, "the request events projection was not scanned").toContain("reasonCode");
    // Every `.select(` in the module resolved to something. A blank entry means
    // an argument shape this scan cannot read, which is a hole, not a pass.
    expect(SELECTS.filter((s) => s === "")).toEqual([]);
  });

  it("selects no column that can hold free text, an address or a credential", () => {
    for (const select of SELECTS) {
      for (const rawItem of select.split(",")) {
        const item = rawItem.trim();
        if (!item) continue;
        // `alias:expr` — the projection is the right-hand side.
        const expr = item.includes(":") ? item.slice(item.indexOf(":") + 1) : item;

        if (expr.includes("->>")) {
          const [base, key] = expr.split("->>");
          const allowedKeys = ALLOWED_JSON.get(base.trim());
          expect(allowedKeys, `${base} is not an allowed jsonb projection`).toBeTruthy();
          expect(
            allowedKeys!.has(key.trim()),
            `${expr} reads a jsonb key that is not on the allow-list`
          ).toBe(true);
          continue;
        }

        expect(
          FORBIDDEN_BARE.has(expr),
          `the analytics projection selects "${expr}", which can carry personal data`
        ).toBe(false);
      }
    }
  });

  it("never selects a whole row", () => {
    expect(AGGREGATION_SOURCE).not.toMatch(/\.select\(\s*\)/);
    expect(AGGREGATION_SOURCE).not.toMatch(/\.select\(\s*"\*"/);
  });
});

/* =====================================================================
 * 1b. EVERY VOCABULARY IS PINNED TO THE CONSTRAINT THAT OWNS IT
 *
 * `bucketize` refusing an unknown key is what makes the privacy guarantee
 * structural — and it is also what makes a WRONG vocabulary silent. A list
 * that drifts from its CHECK constraint does not throw; it buckets every real
 * row as `unrecognised`, and `unrecognised: 2` reads exactly like a
 * measurement.
 *
 * This is not hypothetical. The first draft of this module guessed the
 * conversation kinds as support/help/delivery/merchant/operations (the
 * constraint says merchant_support/delivery_chat/delivery_help) and counted a
 * `due_state` of "breached", which the constraint does not permit at all — so
 * `overdueConversations` could only ever have been zero. Reading and unit
 * tests both passed; a live read against the real project is what caught it.
 * These assertions catch it offline, from the migrations.
 * ===================================================================== */

describe("every closed vocabulary matches the CHECK constraint in the migrations", () => {
  const MIGRATIONS = path.join(ROOT, "supabase/migrations");

  /**
   * The value list of a named CHECK constraint, taken from the LAST migration
   * that defines it — a later migration may drop and recreate one.
   * Handles both `check (col in ('a','b'))` and `check (col = any (array[…]))`.
   */
  function constraintValues(name: string): string[] | null {
    let found: string[] | null = null;
    for (const file of readdirSync(MIGRATIONS).sort()) {
      const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
      const re = new RegExp(`constraint\\s+${name}\\b([\\s\\S]{0,4000}?)\\bcheck\\s*\\(([\\s\\S]*?)\\)\\s*[,;)]`, "gi");
      for (const m of sql.matchAll(re)) {
        const literals = m[2].match(/'([^']*)'/g);
        if (literals) found = literals.map((l) => l.slice(1, -1));
      }
    }
    return found;
  }

  const CASES = Object.entries(ANALYTICS_VOCABULARY.fromConstraint);
  const PLUS = Object.entries(ANALYTICS_VOCABULARY.fromConstraintPlusNotRecorded);

  it("finds every constraint it is meant to read", () => {
    // A lookup that quietly returned null would make every case below vacuous.
    const missing = [...CASES, ...PLUS]
      .map(([name]) => name)
      .filter((name) => constraintValues(name) === null);
    expect(missing).toEqual([]);
    expect(CASES.length + PLUS.length).toBeGreaterThanOrEqual(16);
  });

  for (const [name, declared] of CASES) {
    it(`${name} matches the declared vocabulary`, () => {
      expect([...declared].sort()).toEqual([...(constraintValues(name) ?? [])].sort());
    });
  }

  for (const [name, [declared, extra]] of PLUS) {
    it(`${name} matches the declared vocabulary plus ${extra}`, () => {
      const fromSql = [...(constraintValues(name) ?? []), extra].sort();
      expect([...declared].sort()).toEqual(fromSql);
    });
  }

  it("buckets every constraint value as itself, never as unrecognised", () => {
    /* The assertion that would have caught the live defect directly: feed a
       dimension its own vocabulary and no row may land in `unrecognised`. */
    for (const [name, declared] of CASES) {
      const rows = bucketize([...declared], declared, {});
      expect(
        rows.filter((r) => r.key === UNRECOGNISED_KEY),
        `${name} rejects one of its own values`
      ).toEqual([]);
    }
  });
});

/* =====================================================================
 * 2. OPS-014 ATTRIBUTION — the constraint that invites a lie
 * ===================================================================== */

function request(over: Partial<RequestRow>): RequestRow {
  return {
    id: uuid(1), business_account_id: uuid(90),
    created_at: "2026-09-10T10:00:00.000Z", submitted_at: "2026-09-10T10:05:00.000Z",
    request_state: "declined", review_state: "declined",
    service_area_review_state: "in_area", quote_status: "estimated",
    payer_type: "merchant", requester_kind: "business", service_level: "standard",
    weight_band: "0_25_lb", restricted_class: "none",
    loaded_miles: 4.2, billable_loaded_miles: 4.2,
    review_reasons: [], timing_review_reasons: [],
    pickup_city: "Stafford", pickup_region: "VA", pickup_country: "US",
    ...over,
  };
}

function event(over: Partial<TerminalEventRow>): TerminalEventRow {
  return {
    request_id: uuid(1), actor_type: "operations",
    command: "decline_delivery_request", created_at: "2026-09-10T11:00:00.000Z",
    reason_code: null,
    ...over,
  };
}

function unmet(requests: RequestRow[], events: TerminalEventRow[] = []): UnmetDemandSource {
  return { requests, terminalEvents: events, workspaces: [], truncatedSources: [] };
}

describe("OPS-014 attributes only what was actually recorded", () => {
  it("uses the governed couranr-decline-v1 code when the decline event carries one", () => {
    for (const code of Object.keys(DECLINE_REASON_LABELS)) {
      expect(
        attributeCause(request({ request_state: "declined" }), [event({ reason_code: code })])
      ).toBe(code);
    }
  });

  it("does not invent a reason when a decline recorded none", () => {
    expect(attributeCause(request({ request_state: "declined" }), [event({})])).toBe(
      "declined_reason_not_recorded"
    );
  });

  it("refuses a decline code that is not in the governed vocabulary", () => {
    /* A code from outside couranr-decline-v1 is not a cause: the migration's
       `case` is the allow-list and the message table at once, so a value it
       does not know has no agreed meaning to report. */
    expect(
      attributeCause(request({ request_state: "declined" }), [
        event({ reason_code: "lost_the_customer" }),
      ])
    ).toBe("declined_reason_not_recorded");
  });

  it("attributes a cancellation to the recorded ACTOR, never to its free-text reason", () => {
    /* `couranr_cancel_delivery_request` stores `btrim(p_reason)` with no
       vocabulary at all, so the reason is unbounded operator prose. What IS
       recorded and CHECK-constrained is the actor. */
    expect(
      attributeCause(request({ request_state: "cancelled" }), [
        event({ command: "cancel_delivery_request", actor_type: "operations" }),
      ])
    ).toBe("cancelled_by_operations");
    expect(
      attributeCause(request({ request_state: "cancelled" }), [
        event({ command: "cancel_delivery_request", actor_type: "customer" }),
      ])
    ).toBe("cancelled_by_customer");
  });

  it("keeps a customer cancellation, a service-area decline and a Couranr decline apart", () => {
    const value = aggregateUnmetDemand(
      unmet(
        [
          request({ id: uuid(1), request_state: "cancelled" }),
          request({ id: uuid(2), request_state: "declined", service_area_review_state: "declined" }),
          request({ id: uuid(3), request_state: "declined" }),
        ],
        [
          event({ request_id: uuid(1), command: "cancel_delivery_request", actor_type: "customer" }),
          event({ request_id: uuid(2), reason_code: "outside_service_area" }),
          event({ request_id: uuid(3), reason_code: "no_driver_available" }),
        ]
      ),
      ALL,
      NOW
    );

    const byKey = Object.fromEntries(value.causes.rows.map((r) => [r.key, r.count]));
    expect(byKey).toEqual({
      cancelled_by_customer: 1,
      outside_service_area: 1,
      no_driver_available: 1,
    });
    /* Three facts, three rows. There is no single total on this object that
       could be read as "customers lost". */
    expect(value.causes.rows).toHaveLength(3);
    expect(value.unattributed).toBe(0);
  });

  it("shows an unattributed request as itself and never folds it into a cause", () => {
    const value = aggregateUnmetDemand(
      unmet([request({ request_state: "cancelled" })], []),
      ALL,
      NOW
    );
    /* No terminal event at all: the state says cancelled, nothing says by whom.
       The registry's own OPS-014 state is "partial attribution". */
    expect(value.causes.rows).toEqual([
      { key: "cancelled_actor_not_recorded", label: CAUSE_LABELS.cancelled_actor_not_recorded, count: 1 },
    ]);
    expect(value.causes.state).toBe("live");
    expect(value.unattributed).toBe(0);
  });

  it("never counts an unsubmitted draft as demand Couranr could not confirm", () => {
    const value = aggregateUnmetDemand(
      unmet([
        request({ id: uuid(1), request_state: "draft", submitted_at: null }),
        request({ id: uuid(2), request_state: "awaiting_merchant_confirmation", submitted_at: null }),
      ]),
      ALL,
      NOW
    );
    expect(value.universe.neverSubmitted).toBe(2);
    expect(value.universe.couldNotConfirm).toBe(0);
    expect(value.causes.state).toBe("empty");
  });

  it("never counts a request still in review as one Couranr could not confirm", () => {
    const value = aggregateUnmetDemand(
      unmet([
        request({ id: uuid(1), request_state: "pending_couranr_review" }),
        request({ id: uuid(2), request_state: "awaiting_quote_acceptance" }),
        request({ id: uuid(3), request_state: "quote_revision_required" }),
      ]),
      ALL,
      NOW
    );
    expect(value.universe.stillOpen).toBe(3);
    expect(value.universe.couldNotConfirm).toBe(0);
  });

  it("partitions every request into exactly one of the four outcomes", () => {
    /* A request state that fell through all four buckets would make the split
       silently understate something, which is the failure the split exists to
       prevent. */
    const rows = ANALYTICS_VOCABULARY.requestStates.map((state, i) =>
      request({ id: uuid(i + 1), request_state: state })
    );
    const u = aggregateUnmetDemand(unmet(rows), ALL, NOW).universe;
    expect(u.confirmed + u.neverSubmitted + u.stillOpen + u.couldNotConfirm).toBe(rows.length);
  });

  it("keeps service-area disposition separate from cause, because they can both be true", () => {
    const value = aggregateUnmetDemand(
      unmet(
        [request({ request_state: "cancelled", service_area_review_state: "out_of_area_review" })],
        [event({ command: "cancel_delivery_request", actor_type: "operations" })]
      ),
      ALL,
      NOW
    );
    expect(value.causes.rows[0].key).toBe("cancelled_by_operations");
    expect(value.serviceArea.rows[0].key).toBe("out_of_area_review");
  });

  it("flags review and timing triggers as multi-valued so their counts are not read as requests", () => {
    const value = aggregateUnmetDemand(
      unmet([
        request({
          review_reasons: ["route_needs_review", "weight_unresolved"],
          timing_review_reasons: ["same_day_after_cutoff"],
        }),
      ]),
      ALL,
      NOW
    );
    expect(value.reviewTriggers.multiValued).toBe(true);
    expect(value.reviewTriggers.rows.reduce((a, b) => a + b.count, 0)).toBe(2);
    expect(value.universe.couldNotConfirm).toBe(1);
    expect(value.timingTriggers.multiValued).toBe(true);
  });
});

/* =====================================================================
 * 3. NO INVENTED NUMBERS
 * ===================================================================== */

describe("an empty database renders empty, not zeros", () => {
  const emptySource: AnalyticsSource = {
    requests: [], deliveries: [], obligations: [], proofs: [], assignments: [],
    drivers: [], incidents: [], problemReports: [], conversations: [],
    workspaces: [], truncatedSources: [],
  };

  it("reports the OPS-013 screen as empty rather than a page of zeros", () => {
    const value = aggregateOperationsAnalytics(emptySource, ALL, NOW);
    expect(value.state).toBe("empty");
    for (const p of [value.markets, value.categories, value.payerMix, value.requesterMix]) {
      expect(p.state).toBe("empty");
      expect(p.rows).toEqual([]);
    }
  });

  it("returns null, not zero, for an average with nothing to average", () => {
    const value = aggregateOperationsAnalytics(emptySource, ALL, NOW);
    expect(value.economics.averageCapturedCents).toBeNull();
    expect(value.economics.paidDeliveryCount).toBe(0);
  });

  it("reports the OPS-014 screen as empty rather than zero unmet demand", () => {
    const value = aggregateUnmetDemand(unmet([]), ALL, NOW);
    expect(value.state).toBe("empty");
    expect(value.causes.state).toBe("empty");
  });

  it("renders a measure it cannot derive as not_measurable with its reason", () => {
    const value = aggregateOperationsAnalytics(emptySource, ALL, NOW);
    const rate = value.driverUtilization.utilizationRate;
    expect(rate.state).toBe("not_measurable");
    expect(rate.rows).toEqual([]);
    expect(rate.reason).toMatch(/no denominator/i);
  });

  it("marks a truncated source as partial so a count is read as a floor", () => {
    const value = aggregateOperationsAnalytics(
      { ...emptySource, requests: [request({})], truncatedSources: ["requests"] },
      ALL,
      NOW
    );
    expect(value.state).toBe("partial");
    expect(value.truncatedSources).toEqual(["requests"]);
  });
});

describe("money is counted from captures only", () => {
  it("counts a capture and ignores an authorization", () => {
    const base = {
      requests: [request({ id: uuid(1) }), request({ id: uuid(2) })],
      deliveries: [], proofs: [], assignments: [], drivers: [], incidents: [],
      problemReports: [], conversations: [], workspaces: [], truncatedSources: [],
    };
    const value = aggregateOperationsAnalytics(
      {
        ...base,
        obligations: [
          {
            id: uuid(10), request_id: uuid(1), created_at: NOW, payer_type: "merchant",
            payment_state: "captured", amount_cents: 1299,
            captured_at: "2026-09-11T00:00:00.000Z", captured_amount_cents: 1299,
            refunded_at: null, refunded_amount_cents: null,
          },
          {
            /* Authorized only: a hold, not revenue. */
            id: uuid(11), request_id: uuid(2), created_at: NOW, payer_type: "customer",
            payment_state: "authorized", amount_cents: 5000,
            captured_at: null, captured_amount_cents: null,
            refunded_at: null, refunded_amount_cents: null,
          },
        ],
      } as AnalyticsSource,
      ALL,
      NOW
    );
    expect(value.economics.capturedCents).toBe(1299);
    expect(value.paidDeliveries.count).toBe(1);
    expect(value.economics.averageCapturedCents).toBe(1299);
  });

  it("counts one paid delivery per REQUEST, not per obligation", () => {
    /* Nothing in the schema limits a request to one payment obligation —
       supersession creates a second row — so counting obligations would report
       two paid deliveries for one delivery. */
    const obligation = (id: number) => ({
      id: uuid(id), request_id: uuid(1), created_at: NOW, payer_type: "merchant",
      payment_state: "captured", amount_cents: 1000,
      captured_at: "2026-09-11T00:00:00.000Z", captured_amount_cents: 1000,
      refunded_at: null, refunded_amount_cents: null,
    });
    const value = aggregateOperationsAnalytics(
      {
        requests: [request({ id: uuid(1) })],
        obligations: [obligation(10), obligation(11)],
        deliveries: [], proofs: [], assignments: [], drivers: [], incidents: [],
        problemReports: [], conversations: [], workspaces: [], truncatedSources: [],
      } as AnalyticsSource,
      ALL,
      NOW
    );
    expect(value.paidDeliveries.count).toBe(1);
    // The money is still both captures; only the delivery count is deduplicated.
    expect(value.economics.capturedCents).toBe(2000);
  });

  it("counts a delivery captured at zero as paid, in the count AND the breakdown", () => {
    /* A delivery fully covered by promotional credit captures zero. It is a
       paid delivery — a capture happened — and the count and the fulfillment
       breakdown must agree about it. The live project's one delivery is
       exactly this shape, which is how the disagreement was noticed. */
    const value = aggregateOperationsAnalytics(
      {
        requests: [request({ id: uuid(1) })],
        deliveries: [
          {
            id: uuid(2), request_id: uuid(1), business_account_id: uuid(90),
            created_at: NOW, fulfillment_state: "delivered", service_level: "standard",
            proof_method: "photo_or_pin", plan_source: "automatic",
            promotional_credit_cents: 3340, standard_quote_cents: 3340,
          },
        ],
        obligations: [
          {
            id: uuid(10), request_id: uuid(1), created_at: NOW, payer_type: "merchant",
            payment_state: "captured", amount_cents: 0,
            captured_at: "2026-09-11T00:00:00.000Z", captured_amount_cents: 0,
            refunded_at: null, refunded_amount_cents: null,
          },
        ],
        proofs: [], assignments: [], drivers: [], incidents: [],
        problemReports: [], conversations: [], workspaces: [], truncatedSources: [],
      } as AnalyticsSource,
      ALL,
      NOW
    );
    expect(value.paidDeliveries.count).toBe(1);
    expect(value.paidDeliveries.byFulfillmentState.rows).toEqual([
      { key: "delivered", label: "Delivered", count: 1 },
    ]);
    expect(value.economics.averageCapturedCents).toBe(0);
  });
});

/* =====================================================================
 * 4. SMALL UNITS THE ABOVE DEPENDS ON
 * ===================================================================== */

describe("the market classifier only ever emits a closed key", () => {
  it("names each of the four launch markets", () => {
    expect(classifyMarket({ pickup_city: "Stafford", pickup_region: "VA", pickup_country: "US" }))
      .toBe("US|VA|stafford");
    expect(classifyMarket({ pickup_city: "Washington", pickup_region: "DC", pickup_country: "US" }))
      .toBe("US|DC|washington");
  });

  it("buckets an unserved city without naming it", () => {
    expect(classifyMarket({ pickup_city: "Richmond", pickup_region: "VA", pickup_country: "US" }))
      .toBe("outside_launch_markets");
  });

  it("says not recorded when the address was never verified", () => {
    expect(classifyMarket({ pickup_city: null, pickup_region: null, pickup_country: null }))
      .toBe("market_not_recorded");
  });
});

describe("distance bands follow the Pricing Authority V2 boundaries", () => {
  it("bands on 2, 10 and 25 loaded miles", () => {
    expect(distanceBand(0)).toBe("0_2");
    expect(distanceBand(2)).toBe("0_2");
    expect(distanceBand(2.001)).toBe("2_10");
    expect(distanceBand(10)).toBe("2_10");
    expect(distanceBand(10.5)).toBe("10_25");
    expect(distanceBand(25)).toBe("10_25");
    expect(distanceBand(25.1)).toBe("over_25");
  });

  it("does not invent a band for an unrecorded distance", () => {
    expect(distanceBand(null)).toBe("not_recorded");
  });
});

describe("bucketize is the closed-vocabulary guard", () => {
  it("keeps a declared key and refuses everything else", () => {
    const rows = bucketize(["a", "b", "zzz", null, undefined], ["a", "b"], { a: "A", b: "B" });
    expect(Object.fromEntries(rows.map((r) => [r.key, r.count]))).toEqual({
      a: 1, b: 1, [UNRECOGNISED_KEY]: 3,
    });
  });
});

describe("filters are parsed, never trusted", () => {
  it("keeps a declared market, category and payer", () => {
    const f = parseFilters(
      new URLSearchParams("days=90&market=US|VA|stafford&category=repair_and_electronics&payer=merchant")
    );
    expect(f).toEqual({
      days: 90, market: "US|VA|stafford", category: "repair_and_electronics", payer: "merchant",
    });
  });

  it("drops a value that is not in the vocabulary rather than filtering on it", () => {
    const f = parseFilters(
      new URLSearchParams("days=nonsense&market=Richmond&category=%27%20or%201%3D1&payer=admin")
    );
    expect(f).toEqual({ days: 30, market: null, category: null, payer: null });
  });

  it("accepts the all-history window", () => {
    expect(parseFilters(new URLSearchParams("days=all")).days).toBeNull();
  });

  it("holds a market filter to the same closed vocabulary the output uses", () => {
    for (const key of ANALYTICS_VOCABULARY.markets) {
      expect(parseFilters(new URLSearchParams(`market=${encodeURIComponent(key)}`)).market).toBe(key);
    }
  });
});
