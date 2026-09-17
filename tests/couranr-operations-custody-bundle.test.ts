import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCustodyBundle,
  CUSTODY_BUNDLE_FORBIDDEN_SUBSTRINGS,
  CUSTODY_PROOF_TYPES,
  PROTECTION_LEVELS_WITH_CUSTODY,
  type CustodyBundleRows,
} from "@/lib/couranr/operations/custodyBundle";
import { buildAssignedDeliveryProjection } from "@/lib/couranr/dispatch/projection";

/**
 * OPS-012 — the custody bundle an investigator reads to decide a claim.
 *
 * The four invariants that are worth a test rather than a comment:
 *
 *   1. No private object's LOCATION leaves the server. The bundle reads
 *      `storage_object_path` to answer `hasMedia` and must publish neither it
 *      nor the bucket nor a signed URL, at any depth.
 *   2. A failed read is reported as a failed read, never as an absent fact.
 *   3. Resolving an incident moves no money, and a customer claim issues no
 *      product-value compensation on its own.
 *   4. `declared_value_cents` is Operations-only. The driver projection must
 *      still exclude it — it is a theft incentive and the driver is standing
 *      next to the box.
 */

const ROOT = path.resolve(__dirname, "..");

/* ══════════════════════════════════════════════════════════════ fixtures ══ */

const DELIVERY_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const PREPACK_ID = "33333333-3333-4333-8333-333333333333";
const SEALED_ID = "44444444-4444-4444-8444-444444444444";
const DROPOFF_SEAL_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "66666666-6666-4666-8666-666666666666";

/**
 * Deliberately hostile rows: every column that could carry a location or a
 * credential's stored form is populated, so a projection that copied a row
 * wholesale would fail the guard rather than pass it silently.
 */
function rows(over: Partial<CustodyBundleRows> = {}): CustodyBundleRows {
  return {
    delivery: {
      id: DELIVERY_ID,
      request_id: REQUEST_ID,
      fulfillment_state: "delivered",
      // Present on the real row and never selected. If a future edit widens the
      // select to `*`, these are what the guard catches.
      business_account_id: "77777777-7777-4777-8777-777777777777",
      captured_amount_cents: 1299,
    },
    request: {
      id: REQUEST_ID,
      reference: "CR-7Q2M-4KDX",
      requester_kind: "consumer",
      restricted_class: "alcohol",
      pickup_manifest: {
        description: "Two sealed bottles in a padded carton",
        packageCount: 1,
        orderReference: "SO-4417",
        handlingNotes: "Keep upright",
        source: "consumer_statement",
      },
      pickup_manifest_policy_version: "pickup-handoff-v2",
      declared_value_cents: 24000,
      protection_level: "protected_handoff",
      protection_policy_version: "couranr-protection-v1-2026-09-01",
      sender_terms_version: "couranr-terms-v3",
      sender_terms_accepted_at: "2026-09-10T14:00:00.000Z",
      sender_electronic_consent_at: "2026-09-10T14:00:01.000Z",
      sender_adult_attested_at: "2026-09-10T14:00:02.000Z",
      recipient_adult_attested_at: "2026-09-10T18:30:00.000Z",
      recipient_attestation_version: "couranr-recipient-attestation-v1",
    },
    proofs: [
      {
        id: PREPACK_ID,
        proof_stage: "pickup",
        proof_type: CUSTODY_PROOF_TYPES.prepack,
        finalized_at: "2026-09-10T15:00:00.000Z",
        captured_at: "2026-09-10T14:59:30.000Z",
        storage_object_path: "couranr/proofs/11111111/33333333/abc.jpg",
        storage_bucket: "delivery-photos",
      },
      {
        id: SEALED_ID,
        proof_stage: "pickup",
        proof_type: CUSTODY_PROOF_TYPES.sealedPackage,
        finalized_at: "2026-09-10T15:02:00.000Z",
        captured_at: "2026-09-10T15:01:40.000Z",
        storage_object_path: "couranr/proofs/11111111/44444444/def.jpg",
        storage_bucket: "delivery-photos",
      },
      {
        id: DROPOFF_SEAL_ID,
        proof_stage: "dropoff",
        proof_type: CUSTODY_PROOF_TYPES.dropoffSeal,
        finalized_at: "2026-09-10T18:29:00.000Z",
        captured_at: "2026-09-10T18:28:50.000Z",
        storage_object_path: "couranr/proofs/11111111/55555555/ghi.jpg",
        storage_bucket: "delivery-photos",
      },
    ],
    seal: {
      seal_identifier: "CRS-88231",
      applied_at: "2026-09-10T15:03:00.000Z",
      sealed_package_proof_id: SEALED_ID,
      dropoff_condition: "intact",
      dropoff_recorded_at: "2026-09-10T18:29:30.000Z",
    },
    identity: {
      provider: "stripe_identity",
      verification_state: "verified",
      identity_verified: true,
      adult_verified: true,
      authorized_recipient_match: true,
      verified_at: "2026-09-10T18:31:00.000Z",
      policy_version: "couranr-identity-v1",
      // Never selected by the reader; present here so the guard proves it.
      provider_reference: "vs_test_1234567890",
    },
    handoffRecords: [
      {
        handoff_stage: "dropoff",
        observed_package_count: 1,
        latitude: 38.42111,
        longitude: -77.40222,
        accuracy_m: 6,
        proof_method_used: "direct_handoff",
        recorded_at: "2026-09-10T18:32:00.000Z",
      },
      {
        handoff_stage: "pickup",
        observed_package_count: 1,
        latitude: 38.4,
        longitude: -77.38,
        accuracy_m: 9,
        proof_method_used: null,
        recorded_at: "2026-09-10T15:05:00.000Z",
      },
    ],
    handoffCodes: [
      {
        code_kind: "merchant_pickup",
        code_state: "consumed",
        generation: 1,
        issued_at: "2026-09-10T14:30:00.000Z",
        expires_at: "2026-09-10T20:30:00.000Z",
        failed_attempts: 0,
        consumed_at: "2026-09-10T15:04:00.000Z",
        // Never selected by the reader; present here so the guard proves it.
        code_digest: "6f1b0c2d3e4f5061728394a5b6c7d8e9",
      },
      {
        code_kind: "recipient_dropoff",
        code_state: "consumed",
        generation: 2,
        issued_at: "2026-09-10T18:00:00.000Z",
        expires_at: "2026-09-11T02:00:00.000Z",
        failed_attempts: 1,
        consumed_at: "2026-09-10T18:31:30.000Z",
        code_digest: "aa1b0c2d3e4f5061728394a5b6c7d8e9",
      },
    ],
    claims: [
      {
        id: CLAIM_ID,
        problem_type: "damaged",
        details: "One bottle arrived cracked.",
        report_state: "under_review",
        submitted_at: "2026-09-11T09:00:00.000Z",
        resolved_at: null,
        version: 2,
      },
    ],
    claimEvidence: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        report_id: CLAIM_ID,
        upload_state: "verified",
        finalized_at: "2026-09-11T09:01:00.000Z",
        object_path: "problem/66666666/88888888/jkl.jpg",
        storage_bucket: "delivery-photos",
      },
      {
        id: "99999999-9999-4999-8999-999999999999",
        report_id: CLAIM_ID,
        upload_state: "pending",
        finalized_at: null,
        object_path: "problem/66666666/99999999/mno.jpg",
      },
    ],
    incidents: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        incident_type: "damage",
        incident_state: "under_review",
        severity: "urgent",
        summary: "Customer reports a cracked bottle.",
        opened_at: "2026-09-11T09:05:00.000Z",
        resolved_at: null,
        closed_at: null,
        version: 1,
      },
    ],
    unavailable: [],
    ...over,
  };
}

/** Every key name in a serialized object, at any depth. */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

/* ════════════════════════════════════ 1. no private location ever leaves ══ */

describe("the custody bundle publishes no object location", () => {
  /**
   * POSITIVE CONTROL, first.
   *
   * A negative result is a claim about the query before it is a claim about
   * the data. Every assertion below says "this string is absent"; none of them
   * is worth anything until the same check is shown to FIND one. This repo has
   * already reported an absence that was really a broken query.
   */
  it("the guard catches a bundle that did leak", () => {
    const leaky = {
      evidence: [{ proofId: "x", storage_object_path: "couranr/proofs/a/b/c.jpg" }],
      nested: { deep: { signedUrl: "https://example.test/signed" } },
    };
    const json = JSON.stringify(leaky);
    const caught = CUSTODY_BUNDLE_FORBIDDEN_SUBSTRINGS.filter((b) => json.includes(b));
    // `object_path` is caught as well — it is a substring of
    // `storage_object_path`, and deliberately listed in its own right so a
    // column named `object_path` (which the claim-evidence table really does
    // use) cannot slip past a guard written only for the proofs table.
    expect(caught.sort()).toEqual(["object_path", "signedUrl", "storage_object_path"]);
    expect(allKeys(leaky)).toContain("storage_object_path");
    expect(allKeys(leaky)).toContain("signedUrl");
  });

  it("the guard list is not empty and names the four families it must", () => {
    // A list that quietly became `[]` would make every check below pass.
    expect(CUSTODY_BUNDLE_FORBIDDEN_SUBSTRINGS.length).toBeGreaterThan(8);
    for (const required of [
      "storage_object_path",
      "storage_bucket",
      "signedUrl",
      "code_digest",
      "provider_reference",
    ]) {
      expect(CUSTODY_BUNDLE_FORBIDDEN_SUBSTRINGS).toContain(required);
    }
  });

  /**
   * The same guard the tracking projection carries, with the membership its
   * own audience needs: Operations legitimately sees the tenant and the
   * capture coordinates a public tracking link must never carry. What NOBODY
   * receives is where a private object lives or a credential's stored form.
   */
  it("leaks no forbidden substring anywhere in the serialized bundle", () => {
    const json = JSON.stringify(buildCustodyBundle(rows()));
    for (const banned of CUSTODY_BUNDLE_FORBIDDEN_SUBSTRINGS) {
      expect(json, `custody bundle leaked "${banned}"`).not.toContain(banned);
    }
  });

  it("publishes none of the actual paths, digests or provider handles", () => {
    const json = JSON.stringify(buildCustodyBundle(rows()));
    for (const secret of [
      "couranr/proofs/11111111",
      "problem/66666666",
      "abc.jpg",
      "jkl.jpg",
      "6f1b0c2d3e4f5061728394a5b6c7d8e9",
      "vs_test_1234567890",
    ]) {
      expect(json, `custody bundle leaked ${secret}`).not.toContain(secret);
    }
  });

  it("carries no key named for a location or a credential", () => {
    const keys = allKeys(buildCustodyBundle(rows()));
    for (const banned of CUSTODY_BUNDLE_FORBIDDEN_SUBSTRINGS) {
      expect(keys, `custody bundle has a key containing "${banned}"`).not.toContain(banned);
    }
    // And no key SPELLED differently that still names the same thing.
    for (const k of keys) {
      expect(/path|bucket|digest|signedurl/i.test(k), `suspicious key "${k}"`).toBe(false);
    }
  });

  it("reports that media exists without saying where it is", () => {
    const b = buildCustodyBundle(rows());
    expect(b.pickup.prepackPhoto?.hasMedia).toBe(true);
    expect(b.pickup.prepackPhoto?.proofId).toBe(PREPACK_ID);
    // The proof ID is the whole handle. It is exchanged for a short-lived URL
    // at the existing Operations endpoint, where the TTL is chosen by viewer
    // role rather than by any caller.
    expect(Object.keys(b.pickup.prepackPhoto!).sort()).toEqual([
      "capturedAt",
      "finalizedAt",
      "hasMedia",
      "proofId",
      "proofStage",
      "proofType",
    ]);
  });

  it("marks a proof row with no stored object as carrying no media", () => {
    const b = buildCustodyBundle(
      rows({
        proofs: [
          {
            id: PREPACK_ID,
            proof_stage: "pickup",
            proof_type: CUSTODY_PROOF_TYPES.prepack,
            finalized_at: "2026-09-10T15:00:00.000Z",
            captured_at: null,
            storage_object_path: null,
          },
        ],
      })
    );
    expect(b.pickup.prepackPhoto?.hasMedia).toBe(false);
  });

  /**
   * The module must not grow its own signer. PHO-001 fixes the TTL by viewer
   * role inside the proof policy; a second signer here would be a second
   * place for that decision to drift.
   */
  it("mints no signed URL of its own", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/operations/custodyBundle.ts"), "utf8");
    expect(src).not.toMatch(/createSignedUrl/);
    expect(src).not.toMatch(/\.storage\b/);
    expect(src).not.toMatch(/PROOF_URL_TTL_SECONDS/);
  });
});

/* ═══════════════════════════ 2. a failed read is never an absent fact ══════ */

describe("a section that could not be read is named, not silently empty", () => {
  it("carries the unavailable section names through to the bundle", () => {
    const b = buildCustodyBundle(rows({ seal: null, unavailable: ["seal", "identity"] }));
    expect(b.unavailable).toEqual(["seal", "identity"]);
    // And the value stays null rather than becoming a confident "no seal".
    expect(b.seal).toBeNull();
  });

  it("distinguishes 'no seal recorded' from 'the seal could not be read'", () => {
    const readOk = buildCustodyBundle(rows({ seal: null, unavailable: [] }));
    const readFailed = buildCustodyBundle(rows({ seal: null, unavailable: ["seal"] }));
    expect(readOk.seal).toBeNull();
    expect(readFailed.seal).toBeNull();
    // Same value, different meaning — and only `unavailable` carries it.
    expect(readOk.unavailable).toEqual([]);
    expect(readFailed.unavailable).toEqual(["seal"]);
  });

  it("reads every section through the soft-failure wrapper, not a bare await", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/operations/custodyBundle.ts"), "utf8");
    // One `section(` definition plus one call per optional section. A section
    // added without the wrapper would be the read that renders a database
    // fault as "the driver skipped this step".
    const calls = src.match(/await section\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    // The delivery row itself is the ONE hard failure: without it there is no
    // bundle, and an empty one would read as "no custody was recorded".
    expect(src).toContain('code: "not_found"');
    expect(src).toContain("if (delivery.error)");
  });
});

/* ════════════════════════════ 3. reviewing settles nothing ════════════════ */

/** Every migration's text, newest filename last. */
function migrationSources(): Array<{ file: string; sql: string }> {
  const dir = path.join(ROOT, "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(path.join(dir, f), "utf8") }));
}

/**
 * The NEWEST definition of one function, body only.
 *
 * Newest, not first: a later migration replaces an earlier body, and asserting
 * on the original would keep passing after the replacement introduced the very
 * thing being guarded against.
 */
function newestFunctionBody(name: string): string {
  let found: string | null = null;
  for (const { sql } of migrationSources()) {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start === -1) continue;
    const open = sql.indexOf("$fn$", start);
    if (open === -1) continue;
    const close = sql.indexOf("$fn$", open + 4);
    if (close === -1) continue;
    found = sql.slice(open + 4, close);
  }
  if (found === null) throw new Error(`no definition found for ${name}`);
  return found;
}

/** Identifiers that would mean money actually moved or was promised. */
const MONEY_IDENTIFIERS = [
  "couranr_payment_obligations",
  "couranr_payment_refunds",
  "couranr_payment_events",
  "couranr_promotional_credits",
  "captured_amount_cents",
  "amount_paid_cents",
  "refunded_amount_cents",
  "payment_due_cents",
  "promotional_credit_cents",
  "standard_quote_cents",
  "declared_value_cents",
  "stripe",
  "refund",
] as const;

describe("resolving an incident does not move money", () => {
  const body = newestFunctionBody("couranr_transition_delivery_incident");

  it("finds the command it is meant to police", () => {
    // A negative result is a claim about the query first. Prove it can find a
    // positive before believing what it says is absent.
    expect(body).toContain("resolve_incident");
    expect(body).toContain("couranr_delivery_incidents");
  });

  it("names no money table, column or provider", () => {
    for (const id of MONEY_IDENTIFIERS) {
      expect(body.toLowerCase(), `incident transition references ${id}`).not.toContain(id);
    }
  });

  it("writes only the incident and its event trail", () => {
    const writes = [...body.matchAll(/(?:update|insert\s+into)\s+(?:public\.)?(\w+)/gi)].map(
      (m) => m[1].toLowerCase()
    );
    expect(writes.length).toBeGreaterThan(0);
    expect([...new Set(writes)].sort()).toEqual([
      "couranr_delivery_incident_events",
      "couranr_delivery_incidents",
    ]);
  });

  it("the TypeScript wrapper calls that command and nothing else", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/fulfillment/returns.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function transitionIncident"));
    expect(fn).toContain("couranr_transition_delivery_incident");
    for (const id of ["stripe", "refund", "capture", "credit"]) {
      expect(fn.toLowerCase(), `transitionIncident references ${id}`).not.toContain(id);
    }
  });
});

describe("a customer claim does not issue product-value compensation", () => {
  const body = newestFunctionBody("couranr_transition_customer_problem_report");

  it("finds the command it is meant to police", () => {
    expect(body).toContain("resolve_report");
    expect(body).toContain("couranr_customer_problem_reports");
  });

  it("names no money table, column or provider", () => {
    for (const id of MONEY_IDENTIFIERS) {
      expect(body.toLowerCase(), `claim transition references ${id}`).not.toContain(id);
    }
  });

  it("writes only the report, its events and the conversation turn", () => {
    const writes = [...body.matchAll(/(?:update|insert\s+into)\s+(?:public\.)?(\w+)/gi)].map(
      (m) => m[1].toLowerCase()
    );
    // The extraction found something. Without this the set comparison below
    // would be satisfied by a regex that matched nothing.
    expect(writes.length).toBeGreaterThan(0);
    expect([...new Set(writes)].sort()).toEqual([
      "couranr_conversations",
      "couranr_customer_problem_report_events",
      "couranr_customer_problem_reports",
    ]);
  });

  /**
   * The bundle is a READ. If it ever grew a resolve button, an amount or a
   * credit, "reviewing a claim" and "paying a claim" would become one action.
   */
  it("the bundle carries the declared value and no payable amount", () => {
    const b = buildCustodyBundle(rows());
    expect(b.declaration.declaredValueCents).toBe(24000);
    const keys = allKeys(b);
    for (const k of keys) {
      expect(
        /compensat|payout|refund|credit|settle|award/i.test(k),
        `custody bundle carries a money key "${k}"`
      ).toBe(false);
    }
  });

  it("the route and the panel issue no money command", () => {
    for (const rel of [
      "app/api/couranr/operations/deliveries/[id]/custody/route.ts",
      "lib/couranr/operations/custodyBundle.ts",
      "components/couranr/operations/CustodyBundlePanel.tsx",
    ]) {
      const src = readFileSync(path.join(ROOT, rel), "utf8").toLowerCase();
      // `.rpc(` is how every money command is reached from TypeScript, and
      // every one of these three files is a pure read.
      expect(src, `${rel} calls an RPC`).not.toContain(".rpc(");
      // NOT the bare word "stripe": `stripe_identity` is the identity
      // PROVIDER, which this bundle legitimately reports. What must be absent
      // is the payments surface — the SDK, the money modules and the money
      // commands.
      for (const id of [
        "lib/couranr/payments",
        "lib/couranr/finance",
        "stripe(",
        "paymentintents",
        "capturepayment",
        "issuerefund",
        "promotional_credit",
        "couranr_capture",
        "couranr_refund",
      ]) {
        expect(src, `${rel} references ${id}`).not.toContain(id);
      }
    }
  });
});

/* ══════════════════════ 4. the driver still never sees the declared value ══ */

describe("declared_value_cents is Operations-only", () => {
  it("the custody bundle carries it", () => {
    expect(buildCustodyBundle(rows()).declaration.declaredValueCents).toBe(24000);
  });

  /**
   * The exclusion that must survive this slice.
   *
   * `lib/couranr/dispatch/projection.ts` is a strict allow-list, and the value
   * of the box is the one field a driver standing next to it must never be
   * told. This asserts on the BUILT projection, not just the source, so a
   * spread that reintroduced the column would fail here rather than pass a
   * grep.
   */
  it("the driver projection excludes it, both in source and in what it builds", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/dispatch/projection.ts"), "utf8");
    expect(src).not.toMatch(/declared_value_cents/);
    expect(src).not.toMatch(/declaredValue/);

    const projection = buildAssignedDeliveryProjection({
      delivery: {
        id: DELIVERY_ID,
        version: 3,
        fulfillment_state: "assigned",
        service_level: "standard",
        scheduled_pickup_start: "2026-09-10T14:00:00.000Z",
        scheduled_pickup_end: "2026-09-10T16:00:00.000Z",
        timezone: "America/New_York",
        pickup_address: { line1: "1 Mill Street" },
        dropoff_address: { line1: "18 Rowan Court" },
        recipient: { name: "A Recipient", phone: "5550100", email: "r@example.test" },
        shipment: {
          weightLb: 12,
          additionalStops: 0,
          pickupManifest: { description: "Two sealed bottles", packageCount: 1 },
        },
        proof_method: "direct_handoff",
        signature_required: false,
        vehicle_requirement: {},
        // The hostile part: these ride on the real row and must not survive.
        declared_value_cents: 24000,
        protection_level: "protected_handoff",
        captured_amount_cents: 1299,
      },
      assignment: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", assigned_at: "2026-09-10T13:00:00.000Z" },
      vehicle: null,
      merchant: { name: "A Sender", phone: "5550199" },
    });

    const json = JSON.stringify(projection);
    expect(json).not.toContain("24000");
    expect(json).not.toContain("declaredValue");
    expect(json).not.toContain("declared_value_cents");
    expect(allKeys(projection)).not.toContain("declaredValueCents");
    // The projection still does its job — this is not passing by being empty.
    expect(projection.deliveryId).toBe(DELIVERY_ID);
    expect(projection.shipment.description).toBe("Two sealed bottles");
  });
});

/* ══════════════════════════════════════ 5. the chain the bundle asserts ══ */

describe("the custody chain reads as one story", () => {
  it("assembles every fact an investigator was told to look for", () => {
    const b = buildCustodyBundle(rows());

    expect(b.declaration.description).toBe("Two sealed bottles in a padded carton");
    expect(b.declaration.declaredValueCents).toBe(24000);
    expect(b.declaration.protectionLevel).toBe("protected_handoff");
    expect(b.declaration.protectionPolicyVersion).toBe("couranr-protection-v1-2026-09-01");
    expect(b.senderTerms.termsVersion).toBe("couranr-terms-v3");
    expect(b.senderTerms.termsAcceptedAt).toBe("2026-09-10T14:00:00.000Z");
    expect(b.pickup.credential?.state).toBe("consumed");
    expect(b.pickup.credential?.verifiedAt).toBe("2026-09-10T15:04:00.000Z");
    expect(b.pickup.prepackPhoto?.proofId).toBe(PREPACK_ID);
    expect(b.pickup.sealedPackagePhoto?.proofId).toBe(SEALED_ID);
    expect(b.seal?.sealIdentifier).toBe("CRS-88231");
    expect(b.pickup.place?.recordedAt).toBe("2026-09-10T15:05:00.000Z");
    expect(b.pickup.place?.latitude).toBe(38.4);
    expect(b.seal?.dropoffSealPhoto?.proofId).toBe(DROPOFF_SEAL_ID);
    expect(b.seal?.dropoffCondition).toBe("intact");
    expect(b.dropoff.recipientAdultAttestation.version).toBe(
      "couranr-recipient-attestation-v1"
    );
    expect(b.dropoff.recipientAdultAttestation.attestedAt).toBe("2026-09-10T18:30:00.000Z");
    expect(b.dropoff.identity.state).toBe("verified");
    expect(b.dropoff.identity.authorizedRecipientMatch).toBe(true);
    expect(b.dropoff.recipientCredential?.state).toBe("consumed");
    expect(b.dropoff.recipientCredential?.verifiedAt).toBe("2026-09-10T18:31:30.000Z");
    expect(b.dropoff.place?.recordedAt).toBe("2026-09-10T18:32:00.000Z");
    expect(b.claims[0].evidence.map((e) => e.evidenceId)).toEqual([
      "88888888-8888-4888-8888-888888888888",
    ]);
    expect(b.incidents[0].incidentState).toBe("under_review");
  });

  /**
   * The ordering rule the database enforces for a governed pickup: the
   * sender's credential must be consumed AFTER the documentation, because a
   * confirmation given before the photographs existed cannot be about them.
   */
  it("flags a sender confirmation that preceded the documentation", () => {
    const early = rows();
    (early.handoffCodes as any[])[0].consumed_at = "2026-09-10T14:45:00.000Z";
    expect(buildCustodyBundle(early).pickup.credentialAfterDocumentation).toBe(false);
    expect(buildCustodyBundle(rows()).pickup.credentialAfterDocumentation).toBe(true);
  });

  it("says 'cannot check' rather than 'in order' when a timestamp is missing", () => {
    const noSeal = rows();
    noSeal.proofs = (noSeal.proofs as any[]).filter(
      (p) => p.proof_type !== CUSTODY_PROOF_TYPES.sealedPackage
    );
    expect(buildCustodyBundle(noSeal).pickup.credentialAfterDocumentation).toBeNull();
  });

  /**
   * Mirrors `private.couranr_delivery_protection_level`: a row carrying a
   * level but no policy version was not written by that policy and is not held
   * to its rules. Marking it "required" would invent a breach.
   */
  it("treats a level with no policy version as ungoverned", () => {
    const ungoverned = rows();
    (ungoverned.request as any).protection_policy_version = null;
    const b = buildCustodyBundle(ungoverned);
    expect(b.declaration.protectionGoverned).toBe(false);
    expect(b.pickup.documentationRequired).toBe(false);
    expect(b.dropoff.sealConditionRequired).toBe(false);
    expect(b.dropoff.identity.required).toBe(false);
    expect(b.dropoff.recipientAdultAttestation.required).toBe(false);
  });

  it("requires the identity check only at protected_handoff", () => {
    for (const level of ["standard", "secure_pickup", "protected_handoff"]) {
      const r = rows();
      (r.request as any).protection_level = level;
      const b = buildCustodyBundle(r);
      expect(b.dropoff.identity.required, level).toBe(level === "protected_handoff");
      expect(b.pickup.documentationRequired, level).toBe(
        PROTECTION_LEVELS_WITH_CUSTODY.includes(level)
      );
    }
  });

  it("requires the recipient attestation only for a consumer at protected_handoff", () => {
    const business = rows();
    (business.request as any).requester_kind = "business";
    expect(buildCustodyBundle(business).dropoff.recipientAdultAttestation.required).toBe(false);
    expect(buildCustodyBundle(rows()).dropoff.recipientAdultAttestation.required).toBe(true);
  });

  it("shows only VERIFIED customer evidence", () => {
    const b = buildCustodyBundle(rows());
    // A pending grant is an upload that may never have happened. Listing it as
    // a photograph the customer submitted overstates what Couranr holds.
    expect(b.claims[0].evidence).toHaveLength(1);
  });

  it("reports a credential that was never accepted as having no verified time", () => {
    const locked = rows();
    (locked.handoffCodes as any[])[1] = {
      ...(locked.handoffCodes as any[])[1],
      code_state: "locked",
    };
    const b = buildCustodyBundle(locked);
    expect(b.dropoff.recipientCredential?.state).toBe("locked");
    // The row still carries consumed_at from a superseded generation; the
    // STATE decides whether this credential was ever accepted.
    expect(b.dropoff.recipientCredential?.verifiedAt).toBeNull();
  });

  it("binds the seal to the exact photograph it names, not to any of that type", () => {
    const other = rows();
    (other.seal as any).sealed_package_proof_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(buildCustodyBundle(other).seal?.sealedPackagePhoto).toBeNull();
    // The pickup section still finds one by type — the two are different
    // questions and the bundle answers both.
    expect(buildCustodyBundle(other).pickup.sealedPackagePhoto?.proofId).toBe(SEALED_ID);
  });
});

/* ══════════════════════════════════════════════ 6. the route's own gate ══ */

describe("the custody route is gated and uncached like its neighbours", () => {
  const rel = "app/api/couranr/operations/deliveries/[id]/custody/route.ts";
  const src = readFileSync(path.join(ROOT, rel), "utf8");

  it("resolves an Operations actor before it reads anything", () => {
    expect(src).toContain("resolveRequestActor(req, null)");
    expect(src).toContain("isActorDenied");
    // `null` is the Operations-only scope: no membership is looked up and a
    // caller without the Operations profile role is refused. Asserting on
    // EVERY call rather than on the presence of one, so a second call with a
    // business scope could not slip in beside the first.
    const calls = [...src.matchAll(/resolveRequestActor\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(calls).toEqual(["req, null"]);
  });

  it("opts out of the Data Cache", () => {
    expect(src).toContain('export const dynamic = "force-dynamic"');
  });

  it("validates the delivery id before any lookup", () => {
    expect(src).toMatch(/UUID_RE\.test\(params\.id\)/);
  });

  it("answers under a named key, like every other canonical route", () => {
    // A flat payload is invisible to `tsc` — the routes return untyped JSON —
    // and this repo has already shipped one silent `undefined` that way.
    expect(src).toMatch(/NextResponse\.json\(\{ custody: /);
  });

  it("exposes only GET", () => {
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(src, `custody route exposes ${verb}`).not.toMatch(
        new RegExp(`export async function ${verb}\\b`)
      );
    }
  });

  it("the read path refuses a non-Operations actor", async () => {
    const { readCustodyBundle, isCustodyFailure } = await import(
      "@/lib/couranr/operations/custodyBundle"
    );
    const r = await readCustodyBundle({
      actor: { kind: "member", userId: "u", membership: null } as any,
      deliveryId: DELIVERY_ID,
    });
    expect(isCustodyFailure(r)).toBe(true);
    expect((r as any).code).toBe("not_permitted");
  });
});
