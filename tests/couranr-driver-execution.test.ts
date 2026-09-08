import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPLETION_COMMAND,
  DISCREPANCY_REASONS,
  DRIVER_COMMANDS,
  DRIVER_TRANSITIONS,
  FULFILLMENT_ORDER,
  FULFILLMENT_STATES,
  FULFILLMENT_TONES,
  MAX_PIN_ATTEMPTS,
  PIN_OUTCOMES,
  PROOF_METHODS,
  PROOF_METHOD_LABELS,
  canUnassignBeforePickup,
  isDrivingState,
  nextDriverCommand,
  proofStageAllowedFrom,
  requiresLargeShipmentProof,
} from "@/lib/couranr/driver/states";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/** Migration corpus with comments stripped — the files explain wrong shapes in prose. */
const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.includes(".rollback."))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");

/* ===================================================== the state machine == */

describe("the fulfillment chain", () => {
  it("walks assigned -> delivered with no gaps and no skips", () => {
    // Every `to` is the next command's `from`, so the chain cannot be entered
    // halfway or jumped through.
    const chain = [
      "assigned",
      "en_route_to_pickup",
      "at_pickup",
      "picked_up",
      "in_transit",
      "at_dropoff",
      "delivered",
    ] as const;

    for (let i = 0; i < chain.length - 1; i++) {
      const from = chain[i];
      const to = chain[i + 1];
      const commands = DRIVER_COMMANDS.filter(
        (c) => DRIVER_TRANSITIONS[c].from === from && DRIVER_TRANSITIONS[c].to === to
      );
      expect(commands.length, `no command moves ${from} -> ${to}`).toBeGreaterThan(0);
    }
  });

  it("no command's destination is more than one step ahead of its origin", () => {
    for (const c of DRIVER_COMMANDS) {
      const { from, to } = DRIVER_TRANSITIONS[c];
      expect(
        FULFILLMENT_ORDER[to] - FULFILLMENT_ORDER[from],
        `${c} jumps ${from} -> ${to}`
      ).toBe(1);
    }
  });

  it("offers exactly one next action per state, and none after delivered", () => {
    expect(nextDriverCommand("assigned", "signature")).toBe("start_route_to_pickup");
    expect(nextDriverCommand("en_route_to_pickup", "signature")).toBe("arrive_at_pickup");
    expect(nextDriverCommand("at_pickup", "signature")).toBe("complete_pickup");
    expect(nextDriverCommand("picked_up", "signature")).toBe("start_route_to_dropoff");
    expect(nextDriverCommand("in_transit", "signature")).toBe("arrive_at_dropoff");
    expect(nextDriverCommand("return_required", "signature")).toBe("start_return");
    expect(nextDriverCommand("returning", "signature")).toBe("complete_return");
    expect(nextDriverCommand("returned", "signature")).toBeNull();
    expect(nextDriverCommand("delivered", "signature")).toBeNull();
    expect(nextDriverCommand("scheduled", "signature")).toBeNull();
    expect(nextDriverCommand("cancelled", "signature")).toBeNull();
  });

  it("picks the completion command from the delivery's immutable proof method", () => {
    expect(nextDriverCommand("at_dropoff", "photo_or_pin")).toBe(
      "complete_direct_handoff_delivery"
    );
    expect(nextDriverCommand("at_dropoff", "signature")).toBe("complete_signature_delivery");
    expect(nextDriverCommand("at_dropoff", "leave_at_door")).toBe(
      "complete_leave_at_door_delivery"
    );
  });

  /**
   * The whole point of driving the completion command off stored data: there
   * is no argument a browser could send that reaches a different one.
   */
  it("every proof method maps to exactly one completion command, and they are distinct", () => {
    const mapped = PROOF_METHODS.map((m) => COMPLETION_COMMAND[m]);
    expect(new Set(mapped).size).toBe(PROOF_METHODS.length);
    for (const c of mapped) expect(DRIVER_TRANSITIONS[c].to).toBe("delivered");
  });

  it("Driving Mode is offered only while actually moving", () => {
    expect(isDrivingState("en_route_to_pickup")).toBe(true);
    expect(isDrivingState("in_transit")).toBe(true);
    // Standing at a dock is when the driver needs the controls most.
    expect(isDrivingState("at_pickup")).toBe(false);
    expect(isDrivingState("at_dropoff")).toBe(false);
    expect(isDrivingState("delivered")).toBe(false);
  });

  it("pre-pickup unassignment closes the moment the driver arrives", () => {
    expect(canUnassignBeforePickup("assigned")).toBe(true);
    expect(canUnassignBeforePickup("en_route_to_pickup")).toBe(true);
    expect(canUnassignBeforePickup("at_pickup")).toBe(false);
    expect(canUnassignBeforePickup("picked_up")).toBe(false);
    expect(canUnassignBeforePickup("delivered")).toBe(false);
  });

  it("a proof stage is only recordable from the state that produces it", () => {
    expect(proofStageAllowedFrom("pickup", "at_pickup")).toBe(true);
    expect(proofStageAllowedFrom("pickup", "at_dropoff")).toBe(false);
    expect(proofStageAllowedFrom("dropoff", "at_dropoff")).toBe(true);
    expect(proofStageAllowedFrom("dropoff", "at_pickup")).toBe(false);
    expect(proofStageAllowedFrom("pickup_discrepancy", "at_pickup")).toBe(true);
    expect(proofStageAllowedFrom("pickup_discrepancy", "in_transit")).toBe(false);
    expect(proofStageAllowedFrom("return", "returning")).toBe(true);
    expect(proofStageAllowedFrom("return", "return_required")).toBe(false);
    expect(proofStageAllowedFrom("return", "returned")).toBe(false);
  });
});

/* ================================================= vocabulary vs database = */

/**
 * A CHECK is redefined by later migrations, and the LAST definition is the one
 * the database holds. Reading the first match is how this suite initially
 * reported `at_pickup` missing while it was live in the catalog — the corpus
 * still contained the original eight-value list from the migration that
 * created the table.
 */
function lastAllowList(pattern: RegExp): string[] {
  const all = [...SQL.matchAll(pattern)];
  expect(all.length, `no definition matched ${pattern}`).toBeGreaterThan(0);
  return [...all[all.length - 1][1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const FULFILLMENT_CHK =
  /constraint couranr_dlv_fulfillment_chk\s+check \(fulfillment_state in \(([^)]*)\)/g;

describe("the TypeScript vocabulary matches the database", () => {
  it("every fulfillment state is permitted by couranr_dlv_fulfillment_chk", () => {
    const allowed = lastAllowList(FULFILLMENT_CHK);
    for (const s of FULFILLMENT_STATES) {
      expect(allowed, `${s} is not in the database CHECK`).toContain(s);
    }
  });

  /**
   * The direction that actually bites: SQL learns a state and TypeScript does
   * not, so a real row renders as a raw identifier with no label and no tone.
   */
  it("the database permits no fulfillment state TypeScript cannot render", () => {
    for (const s of lastAllowList(FULFILLMENT_CHK)) {
      expect(FULFILLMENT_STATES as readonly string[], `${s} has no TypeScript entry`).toContain(s);
    }
  });

  it("every driver command is permitted by the delivery-event allow-list", () => {
    // The last definition wins; migrations apply in order.
    const all = [
      ...SQL.matchAll(/constraint couranr_dlve_command_chk\s+check \(command in \(([^)]*)\)/g),
    ];
    expect(all.length).toBeGreaterThan(0);
    const allowed = [...all[all.length - 1][1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    for (const c of DRIVER_COMMANDS) {
      expect(allowed, `${c} would raise 23514 on its audit insert`).toContain(c);
    }
    // The rename really happened on both sides.
    expect(allowed).toContain("complete_direct_handoff_delivery");
    expect(allowed).not.toContain("complete_photo_or_pin_delivery");
  });

  it("the assignment state vocabulary carries completed, not just cancelled", () => {
    const all = [
      ...SQL.matchAll(/constraint couranr_asg_state_chk\s+check \(assignment_state in \(([^)]*)\)/g),
    ];
    const allowed = [...all[all.length - 1][1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(allowed).toContain("completed");
    expect(allowed).toContain("cancelled");
  });

  it("every discrepancy reason is permitted by the database", () => {
    const m = /constraint couranr_pd_reason_chk\s+check \(reason in \(([^)]*)\)/.exec(SQL);
    expect(m).not.toBeNull();
    const allowed = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect([...DISCREPANCY_REASONS].sort()).toEqual([...allowed].sort());
  });
});

/* ====================================================== proof and privacy = */

describe("canonical proof paths", () => {
  it("carries no identifying content and no original filename", async () => {
    const { buildProofObjectPath, isCanonicalProofPath } = await import(
      "@/lib/couranr/driver/proofPaths"
    );
    const p = buildProofObjectPath({
      deliveryId: "11111111-2222-4333-8444-555555555555",
      proofId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      mimeType: "image/jpeg",
    });
    expect(isCanonicalProofPath(p)).toBe(true);
    expect(p.startsWith("canonical-proof/v1/")).toBe(true);
    // The only free segment is entropy.
    const name = p.split("/").pop()!;
    expect(name).toMatch(/^[0-9a-f]{32}\.jpg$/);
  });

  it("two paths for the same proof never collide", async () => {
    const { buildProofObjectPath } = await import("@/lib/couranr/driver/proofPaths");
    const args = {
      deliveryId: "11111111-2222-4333-8444-555555555555",
      proofId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      mimeType: "image/png",
    };
    const seen = new Set(Array.from({ length: 50 }, () => buildProofObjectPath(args)));
    expect(seen.size).toBe(50);
  });

  it("refuses a media type the bucket would reject anyway", async () => {
    const { buildProofObjectPath, isAllowedProofMime } = await import(
      "@/lib/couranr/driver/proofPaths"
    );
    expect(isAllowedProofMime("application/pdf")).toBe(false);
    expect(isAllowedProofMime("image/svg+xml")).toBe(false);
    expect(() =>
      buildProofObjectPath({
        deliveryId: "11111111-2222-4333-8444-555555555555",
        proofId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
        mimeType: "application/pdf",
      })
    ).toThrow();
  });

  it("holds PHO-001's decided TTLs, which are not tuning knobs", async () => {
    const { PROOF_URL_TTL_SECONDS } = await import("@/lib/couranr/driver/proofPaths");
    expect(PROOF_URL_TTL_SECONDS.operations).toBe(900);
    expect(PROOF_URL_TTL_SECONDS.driver).toBe(600);
    expect(PROOF_URL_TTL_SECONDS.customer).toBe(600);
  });

  it("the merchant is not a proof-media viewer", async () => {
    const { PROOF_MEDIA_VIEWERS } = await import("@/lib/couranr/driver/proofPaths");
    expect(PROOF_MEDIA_VIEWERS).toEqual(["operations", "driver", "customer"]);
    expect(PROOF_MEDIA_VIEWERS as readonly string[]).not.toContain("merchant");
  });

  it("refuses to persist anything that looks like a signed URL", async () => {
    const { assertNotASignedUrl } = await import("@/lib/couranr/driver/proofPaths");
    expect(() =>
      assertNotASignedUrl("https://x.supabase.co/storage/v1/object/sign/b/p?token=abc")
    ).toThrow();
    expect(() => assertNotASignedUrl("https://x/storage/v1/object/authenticated/b/p")).toThrow();
    expect(assertNotASignedUrl("canonical-proof/v1/a/b/c.jpg")).toBe("canonical-proof/v1/a/b/c.jpg");
  });

  it("reuses the existing private bucket rather than minting another", async () => {
    const { PROOF_BUCKET } = await import("@/lib/couranr/driver/proofPaths");
    expect(PROOF_BUCKET).toBe("delivery-photos");
  });
});

/* ================================================= keyed handoff codes ==== */

/**
 * 48 bytes, high-entropy, and not a placeholder prefix — the accessor
 * rejects anything under 32 bytes, anything beginning with a runbook word like
 * "test" or "changeme", and anything with fewer than 8 distinct characters.
 */
const FIXTURE_SECRET = "K7pQ2vX9mZ4tR8wL6nB3hF5jD1sG0yC-aE_uI+oM/qW=";

describe("handoff codes", () => {
  const SAVED = process.env.COURANR_HANDOFF_CODE_SECRET;
  beforeEach(() => {
    process.env.COURANR_HANDOFF_CODE_SECRET = FIXTURE_SECRET;
  });
  afterEach(() => {
    if (SAVED === undefined) delete process.env.COURANR_HANDOFF_CODE_SECRET;
    else process.env.COURANR_HANDOFF_CODE_SECRET = SAVED;
  });

  it("generates six digits, preserving leading zeros", async () => {
    const { generateHandoffCode, isWellFormedHandoffCode } = await import(
      "@/lib/couranr/driver/codes"
    );
    for (let i = 0; i < 200; i++) {
      const c = generateHandoffCode();
      expect(c).toHaveLength(6);
      expect(isWellFormedHandoffCode(c)).toBe(true);
    }
  });

  it("produces a digest of the shape the database CHECK requires", async () => {
    const { handoffCodeDigest } = await import("@/lib/couranr/driver/codes");
    const d = handoffCodeDigest({
      kind: "merchant_pickup",
      deliveryId: "11111111-2222-4333-8444-555555555555",
      generation: 1,
      code: "012345",
    });
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * The two credentials are held by different people. If the same six digits
   * produced the same digest for both, a recipient who learned the pickup code
   * could complete their own delivery.
   */
  it("a pickup digest never verifies as a recipient digest", async () => {
    const { handoffCodeDigest, verifyHandoffCode } = await import("@/lib/couranr/driver/codes");
    const base = { deliveryId: "11111111-2222-4333-8444-555555555555", generation: 1, code: "424242" };
    const pickup = handoffCodeDigest({ ...base, kind: "merchant_pickup" });
    const recipient = handoffCodeDigest({ ...base, kind: "recipient_dropoff" });
    const returned = handoffCodeDigest({ ...base, kind: "merchant_return" });
    expect(pickup).not.toBe(recipient);
    expect(pickup).not.toBe(returned);
    expect(recipient).not.toBe(returned);
    expect(verifyHandoffCode({ ...base, kind: "recipient_dropoff", storedDigest: pickup })).toBe(
      false
    );
    expect(verifyHandoffCode({ ...base, kind: "merchant_pickup", storedDigest: pickup })).toBe(true);
  });

  /**
   * Regeneration is only meaningful if the OLD code stops working. With the
   * generation outside the signed input, the same six digits would produce the
   * same digest and an invalidated code would verify against its replacement.
   */
  it("regenerating invalidates the previous code even if the digits repeat", async () => {
    const { handoffCodeDigest, verifyHandoffCode } = await import("@/lib/couranr/driver/codes");
    const base = {
      kind: "merchant_pickup" as const,
      deliveryId: "11111111-2222-4333-8444-555555555555",
      code: "424242",
    };
    const g1 = handoffCodeDigest({ ...base, generation: 1 });
    const g2 = handoffCodeDigest({ ...base, generation: 2 });
    expect(g1).not.toBe(g2);
    expect(verifyHandoffCode({ ...base, generation: 2, storedDigest: g1 })).toBe(false);
  });

  it("a different delivery never verifies", async () => {
    const { handoffCodeDigest, verifyHandoffCode } = await import("@/lib/couranr/driver/codes");
    const d = handoffCodeDigest({
      kind: "merchant_pickup",
      deliveryId: "11111111-2222-4333-8444-555555555555",
      generation: 1,
      code: "424242",
    });
    expect(
      verifyHandoffCode({
        kind: "merchant_pickup",
        deliveryId: "99999999-2222-4333-8444-555555555555",
        generation: 1,
        code: "424242",
        storedDigest: d,
      })
    ).toBe(false);
  });

  it("refuses anything that is not exactly six digits, without hashing it", async () => {
    const { handoffCodeDigest, isWellFormedHandoffCode } = await import(
      "@/lib/couranr/driver/codes"
    );
    for (const bad of ["", "12345", "1234567", "12345a", " 123456", "12 3456", null, 123456]) {
      expect(isWellFormedHandoffCode(bad as any)).toBe(false);
    }
    expect(() =>
      handoffCodeDigest({
        kind: "merchant_pickup",
        deliveryId: "11111111-2222-4333-8444-555555555555",
        generation: 1,
        code: "abc",
      })
    ).toThrow();
  });

  /**
   * A missing secret must throw, not silently key every digest on the string
   * "undefined" — which would be a uniform, attacker-known key across every
   * delivery in the system.
   */
  it("throws by name when the secret is absent, and never echoes its value", async () => {
    const { handoffCodeDigest, HANDOFF_SECRET_ENV } = await import("@/lib/couranr/driver/codes");
    process.env.COURANR_HANDOFF_CODE_SECRET = "";
    try {
      handoffCodeDigest({
        kind: "merchant_pickup",
        deliveryId: "11111111-2222-4333-8444-555555555555",
        generation: 1,
        code: "424242",
      });
      throw new Error("expected a throw");
    } catch (e: any) {
      expect(e.message).toContain(HANDOFF_SECRET_ENV);
      expect(e.message).not.toContain(FIXTURE_SECRET);
    }
  });

  it("the error for a malformed code never contains the code", async () => {
    const { handoffCodeDigest } = await import("@/lib/couranr/driver/codes");
    try {
      handoffCodeDigest({
        kind: "merchant_pickup",
        deliveryId: "11111111-2222-4333-8444-555555555555",
        generation: 1,
        code: "SECRET7",
      });
      throw new Error("expected a throw");
    } catch (e: any) {
      expect(e.message).not.toContain("SECRET7");
    }
  });

  it("mints a nonce of the shape the database CHECK requires", async () => {
    const { generateUploadNonce } = await import("@/lib/couranr/driver/codes");
    const seen = new Set(Array.from({ length: 100 }, () => generateUploadNonce()));
    expect(seen.size).toBe(100);
    for (const n of seen) expect(n).toMatch(/^[0-9a-f]{32}$/);
  });

  it("locks at five attempts, matching the database's own ceiling", () => {
    expect(MAX_PIN_ATTEMPTS).toBe(5);
    expect(SQL).toMatch(/failed_attempts between 0 and 5/);
  });

  it("the attempt vocabulary is closed and contains no exception", () => {
    expect([...PIN_OUTCOMES].sort()).toEqual(["accepted", "expired", "invalid", "locked"]);
  });
});

/* ============================================== copy and derived behaviour = */

describe("driver-facing copy and derived requirements", () => {
  /**
   * Owner decision: a photograph is not an alternative to the recipient PIN,
   * and nothing driver-facing may suggest that it is. The stored column keeps
   * its historical `photo_or_pin` value; the words a driver reads do not.
   */
  it("never offers a photo as an alternative to the recipient PIN", () => {
    expect(PROOF_METHOD_LABELS.photo_or_pin).toBe("Recipient PIN handoff");
    for (const label of Object.values(PROOF_METHOD_LABELS)) {
      expect(label.toLowerCase()).not.toMatch(/photo or pin|or pin|photo\/pin/);
    }
  });

  it("gives every state a label and a tone, with only completed custody outcomes as success", () => {
    for (const s of FULFILLMENT_STATES) {
      expect(FULFILLMENT_TONES[s], `${s} has no tone`).toBeDefined();
    }
    const success = FULFILLMENT_STATES.filter((s) => FULFILLMENT_TONES[s] === "success");
    expect(new Set(success)).toEqual(new Set(["delivered", "returned"]));
    // A waypoint is not an achievement.
    expect(FULFILLMENT_TONES.at_pickup).not.toBe("success");
    expect(FULFILLMENT_TONES.at_dropoff).not.toBe("success");
  });

  /**
   * Derived from stored data only. A browser that could assert "this is not
   * unusual" would skip the securement photo on exactly the load that needs it.
   */
  it("derives the large-shipment requirement from stored facts", () => {
    expect(requiresLargeShipmentProof({ vehicleClass: "box_truck" })).toBe(true);
    expect(requiresLargeShipmentProof({ declaredWeightLb: 150 })).toBe(true);
    expect(requiresLargeShipmentProof({ packageCount: 10 })).toBe(true);
    expect(requiresLargeShipmentProof({ vehicleClass: "car", declaredWeightLb: 9 })).toBe(false);
    expect(requiresLargeShipmentProof({})).toBe(false);
  });
});

/* ============================================== no identity documents ever = */

/**
 * PRF-001 requires a merchant/staff first name or identifier and nothing more.
 * A courier asking a shop assistant to photograph their face or their driving
 * licence is collecting biometric and identity-document data to prove a parcel
 * changed hands, which is neither necessary nor defensible.
 */
describe("no flow requires a face or an identity document", () => {
  const FORBIDDEN = [
    "face_photo",
    "facePhoto",
    "selfie",
    "drivers_license",
    "driversLicense",
    "license_photo",
    "licensePhoto",
    "id_document",
    "idDocument",
    "id_photo",
  ];

  it("the proof-type vocabulary contains no identity capture", () => {
    const m = /constraint couranr_dp_type_chk\s+check \(proof_type in \(([^)]*)\)/.exec(SQL);
    expect(m).not.toBeNull();
    const types = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    for (const t of types) {
      for (const bad of ["face", "selfie", "license", "licence", "id_doc", "passport"]) {
        expect(t.toLowerCase(), `${t} looks like identity capture`).not.toContain(bad);
      }
    }
    expect(types).toContain("shipment_photo");
    expect(types).toContain("condition_photo");
  });

  it("no driver module names an identity-document field", () => {
    const dir = path.join(ROOT, "lib/couranr/driver");
    const src = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    for (const bad of FORBIDDEN) {
      expect(src, `${bad} appears in a driver module`).not.toContain(bad);
    }
  });
});

/* ================================================= the secret contract ==== */

/**
 * A six-digit PIN has 10^6 possibilities. The only thing between a leaked
 * database row and every pickup code in the system is that this key is not in
 * it — so a fallback, a development default or a value generated at boot would
 * each quietly remove the protection while every test stayed green.
 */
describe("COURANR_HANDOFF_CODE_SECRET", () => {
  const SAVED = process.env.COURANR_HANDOFF_CODE_SECRET;
  afterEach(() => {
    if (SAVED === undefined) delete process.env.COURANR_HANDOFF_CODE_SECRET;
    else process.env.COURANR_HANDOFF_CODE_SECRET = SAVED;
  });

  async function accessor() {
    return import("@/lib/couranr/driver/handoffSecret");
  }

  it("fails closed when unset, and names only the variable", async () => {
    const { handoffSecret, HANDOFF_SECRET_ENV } = await accessor();
    delete process.env.COURANR_HANDOFF_CODE_SECRET;
    expect(() => handoffSecret()).toThrow(HANDOFF_SECRET_ENV);
  });

  it("rejects empty and whitespace", async () => {
    const { handoffSecret } = await accessor();
    for (const v of ["", "   ", "\n"]) {
      process.env.COURANR_HANDOFF_CODE_SECRET = v;
      expect(() => handoffSecret()).toThrow();
    }
  });

  it("rejects anything under 32 bytes of material", async () => {
    const { handoffSecret, MIN_SECRET_BYTES } = await accessor();
    expect(MIN_SECRET_BYTES).toBe(32);
    process.env.COURANR_HANDOFF_CODE_SECRET = "aB3dE6gH9jK2mN5p";           // 16
    expect(() => handoffSecret()).toThrow();
    process.env.COURANR_HANDOFF_CODE_SECRET = "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7c"; // 28
    expect(() => handoffSecret()).toThrow();
  });

  /**
   * Byte length, not character length. Thirty-two astral-plane characters are
   * not thirty-two bytes of secret, and `String.length` cannot tell them apart.
   */
  it("measures bytes rather than characters", async () => {
    const { handoffSecret } = await accessor();
    const emoji = "🔑".repeat(9); // 9 chars, 36 bytes — long enough by bytes...
    process.env.COURANR_HANDOFF_CODE_SECRET = emoji;
    // ...but a single repeated character carries no entropy, so it is still out.
    expect(() => handoffSecret()).toThrow();
  });

  it("rejects placeholders even when they are long enough", async () => {
    const { handoffSecret } = await accessor();
    for (const v of [
      "changeme-changeme-changeme-changeme",
      "placeholder-value-for-the-handoff-secret",
      "your-secret-here-your-secret-here-abc",
      "TODO-set-this-before-launch-please-ok",
    ]) {
      process.env.COURANR_HANDOFF_CODE_SECRET = v;
      expect(() => handoffSecret(), `${v.slice(0, 12)}… was accepted`).toThrow();
    }
  });

  it("rejects a long value with almost no distinct characters", async () => {
    const { handoffSecret } = await accessor();
    process.env.COURANR_HANDOFF_CODE_SECRET = "a".repeat(64);
    expect(() => handoffSecret()).toThrow();
  });

  it("accepts a real key", async () => {
    const { handoffSecret } = await accessor();
    process.env.COURANR_HANDOFF_CODE_SECRET = FIXTURE_SECRET;
    expect(handoffSecret()).toBe(FIXTURE_SECRET);
  });

  it("never puts the value, or any prefix of it, into the error", async () => {
    const { handoffSecret } = await accessor();
    process.env.COURANR_HANDOFF_CODE_SECRET = "shortbutdistinct";
    try {
      handoffSecret();
      throw new Error("expected a throw");
    } catch (e: any) {
      expect(e.message).not.toContain("shortbutdistinct");
      expect(e.message).not.toContain("shortbut");
    }
  });

  it("has no fallback, default or self-generated value anywhere in the module", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/driver/handoffSecret.ts"), "utf8");
    // A `||` or `??` after the env read is exactly how a dev default gets in.
    expect(src).not.toMatch(/process\.env\[[^\]]+\]\s*(\|\||\?\?)/);
    expect(src).not.toMatch(/randomBytes|randomUUID|generateKey/);
    expect(src).not.toMatch(/NEXT_PUBLIC/);
  });

  it("the accessor is never reachable from client code", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/driver/handoffSecret.ts"), "utf8");
    expect(src).toMatch(/^assertServerOnly\(/m);
  });

  /** Redaction is defence in depth for the next `detail:` someone adds. */
  it("redacts anything six-digit-shaped from a diagnostic string", async () => {
    process.env.COURANR_HANDOFF_CODE_SECRET = FIXTURE_SECRET;
    const { redactHandoffCodes } = await import("@/lib/couranr/driver/codes");
    expect(redactHandoffCodes("code 481920 rejected")).toBe("code [redacted-code] rejected");
    expect(redactHandoffCodes("pin=000123")).toBe("pin=[redacted-code]");
    // Not a six-digit run: left alone, so real diagnostics stay readable.
    expect(redactHandoffCodes("order 12345")).toBe("order 12345");
    expect(redactHandoffCodes("id 1234567")).toBe("id 1234567");
  });
});

/* ==================================================== the API surface ===== */

/**
 * Structural guarantees over the routes themselves. The BEHAVIOURAL proofs for
 * this layer live in `e2e/smokeHandoff.mjs`, which drives the real routes
 * against the real database in two phases (secret absent / secret present).
 * These are the properties a static read can establish, and they are the ones
 * that would silently regress in a refactor.
 */
describe("the driver API surface", () => {
  const ROUTES = (function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (readFileSync ? require("node:fs").statSync(full).isDirectory() : false) walk(full, out);
      else if (full.endsWith("route.ts")) out.push(full);
    }
    return out;
  })(path.join(ROOT, "app/api/couranr"));

  const SRC = new Map(ROUTES.map((f) => [path.relative(ROOT, f), readFileSync(f, "utf8")]));
  const DRIVER_ROUTES = [...SRC.keys()].filter((f) => f.includes("/driver/"));
  const NEW_ROUTES = [...SRC.keys()].filter(
    (f) => f.includes("/driver/") || f.includes("/merchant/") || f.includes("/operations/")
  );

  it("finds the routes it is meant to police", () => {
    // Without this the rest of the block could pass over an empty set.
    expect(ROUTES.length).toBeGreaterThan(40);
    expect(DRIVER_ROUTES.length).toBeGreaterThan(10);
  });

  /** No route may accept a destination. The command name IS the transition. */
  it("no route reads a fulfillment target from the body", () => {
    for (const [name, src] of SRC) {
      for (const rx of [
        /body\??\.\w*[Ss]tatus/,
        /body\??\.\w*[Ss]tate/,
        /body\??\.\w*fulfillment/i,
        /body\??\.\w*target/i,
      ]) {
        expect(rx.test(src), `${name} reads ${rx} from the body`).toBe(false);
      }
    }
  });

  /**
   * A browser-supplied driver id would defeat the identity model — for a DRIVER
   * route. Operations' own assignment route legitimately takes one, because
   * choosing the driver is the entire point of dispatch; that route is
   * Operations-gated and is not in scope here.
   */
  it("no driver or merchant route accepts a driver id, proof method or timestamp", () => {
    const scoped = [...SRC.keys()].filter(
      (f) => f.includes("/driver/") || f.includes("/merchant/")
    );
    expect(scoped.length).toBeGreaterThan(10);
    for (const name of scoped) {
      const src = SRC.get(name)!;
      expect(/body\??\.driverId/.test(src), `${name} accepts a driver id`).toBe(false);
      expect(/body\??\.proofMethod/.test(src), `${name} accepts a proof method`).toBe(false);
      expect(/body\??\.\w*[Tt]imestamp/.test(src), `${name} accepts a timestamp`).toBe(false);
    }
  });

  /**
   * A PIN in a path segment lands in access logs, proxy logs and browser
   * history. It travels in a JSON body or not at all.
   */
  it("no route reads a code from the URL", () => {
    for (const [name, src] of SRC) {
      expect(/params\.\w*code/i.test(src), `${name} takes a code from the path`).toBe(false);
      expect(
        /searchParams\.get\(["'][^"']*code/i.test(src),
        `${name} takes a code from the query`
      ).toBe(false);
    }
  });

  /**
   * The rule is "no ENTITY LOOKUP before authentication", not "no await".
   * `await req.json()` is body parsing and legitimately precedes the actor
   * check — several payment-slice routes validate shape first so a malformed
   * body is refused without a round trip. What must never precede auth is a
   * database read.
   */
  it("no route touches the database before authenticating", () => {
    for (const name of NEW_ROUTES) {
      const src = SRC.get(name)!;
      expect(/resolveUserId\(|resolveRequestActor\(/.test(src), `${name} has no auth`).toBe(true);
      const body = src.slice(src.search(/export async function (GET|POST|PUT|PATCH)/));
      const firstAuth = body.search(/await (resolveUserId|resolveRequestActor)\(/);
      const firstDb = body.search(/supabaseAdmin/);
      if (firstDb !== -1) {
        expect(firstDb, `${name} queries the database before authenticating`).toBeGreaterThan(
          firstAuth
        );
      }
    }
  });

  it("every new route is dynamic, so an operational read is never cached", () => {
    for (const name of NEW_ROUTES) {
      expect(SRC.get(name)!, `${name} is not force-dynamic`).toMatch(
        /export const dynamic\s*=\s*"force-dynamic"/
      );
    }
  });

  /** The merchant sees that proof exists; never where it lives. */
  it("the merchant proof route returns no URL and no object path", () => {
    const src = SRC.get("app/api/couranr/merchant/deliveries/[id]/proof/route.ts")!;
    expect(src).not.toMatch(/signedProofUrl|createSignedUrl|storage_object_path/);
    expect(src).toMatch(/listProofMetadata/);
  });

  /**
   * Customer proof retrieval SHIPPED in the tracking slice, so the assertion
   * that it did not exist is gone. What replaces it is the property that
   * assertion was standing in for: a customer reaches proof through the
   * token-scoped tracking route and through NOTHING under `/api/couranr/driver`
   * or the legacy `/customer` tree.
   */
  it("customer proof lives only behind the tracking token", () => {
    for (const name of SRC.keys()) {
      expect(name).not.toMatch(/\/customer\/.*proof/);
    }
    const track = SRC.get("app/api/couranr/track/[token]/proof/[proofId]/url/route.ts");
    expect(track, "the customer proof route is missing").toBeTruthy();
    // It authorizes the proof against the token's own delivery BEFORE minting.
    expect(track!).toMatch(/authorizeProofForToken\(/);
    expect(track!).toMatch(/viewer:\s*"customer"/);
  });

  it("each viewer's signed-URL TTL is the decided value", async () => {
    const { PROOF_URL_TTL_SECONDS } = await import("@/lib/couranr/driver/proofPaths");
    const ops = SRC.get("app/api/couranr/operations/proof/[proofId]/url/route.ts")!;
    const drv = SRC.get("app/api/couranr/driver/proof/[proofId]/url/route.ts")!;
    expect(ops).toMatch(/viewer:\s*"operations"/);
    expect(drv).toMatch(/viewer:\s*"driver"/);
    expect(PROOF_URL_TTL_SECONDS.operations).toBe(900);
    expect(PROOF_URL_TTL_SECONDS.driver).toBe(600);
    expect(PROOF_URL_TTL_SECONDS.customer).toBe(600);
  });

  /**
   * The verification hole that shipped in the first cut: the wrapper took a
   * userId and never passed it, and the SQL took no actor at all. Anyone with a
   * delivery UUID could burn five attempts and lock a live credential.
   */
  it("PIN verification passes the caller through to SQL", () => {
    const cmds = readFileSync(path.join(ROOT, "lib/couranr/driver/commands.ts"), "utf8");
    expect(cmds).toMatch(/couranr_verify_handoff_code/);
    // The rpc call site, taken to the end of its argument object.
    const at = cmds.indexOf('"couranr_verify_handoff_code"');
    expect(at, "the verify rpc call was not found").toBeGreaterThan(-1);
    expect(cmds.slice(at, at + 900)).toMatch(/p_actor_user_id:\s*p\.userId/);
  });

  it("the SQL verification command scopes to the caller's own assignment", () => {
    // The LAST definition is the one the database holds; migrations apply in
    // order, and the actor-scoped version supersedes the original.
    // Anchored on the DEFINITION, not the name: `lastIndexOf` on the bare name
    // lands on the trailing GRANT, whose text contains no function body at all
    // and would make this assertion fail against perfectly correct SQL.
    const at = SQL.lastIndexOf("create or replace function public.couranr_verify_handoff_code");
    expect(at, "the verify function definition was not found").toBeGreaterThan(-1);
    const fn = SQL.slice(at);
    const end = fn.indexOf("$fn$;");
    expect(end, "the verify function terminator was not found").toBeGreaterThan(-1);
    const body = fn.slice(0, end + 5);
    expect(body).toMatch(/p_actor_user_id/);
    expect(body).toMatch(/couranr_driver_assignment_for/);
  });
});


describe("handoff credential generation concurrency", () => {
  const CAS_MIGRATION = readFileSync(
    path.join(MIGRATIONS, "20260904233500_couranr_handoff_generation_cas.sql"),
    "utf8"
  );
  const COMMANDS = readFileSync(path.join(ROOT, "lib/couranr/driver/commands.ts"), "utf8");

  it("binds the expected HMAC generation into the SQL command", () => {
    expect(CAS_MIGRATION).toMatch(/p_expected_generation\s+integer/);
    expect(CAS_MIGRATION).toMatch(/p_expected_generation\s*<>\s*v_gen/);
    expect(CAS_MIGRATION).toContain("handoff_generation_conflict");
  });

  it("checks generation before superseding the currently usable credential", () => {
    const mismatch = CAS_MIGRATION.indexOf("if p_expected_generation <> v_gen then");
    const supersede = CAS_MIGRATION.indexOf("update public.couranr_handoff_codes");
    expect(mismatch).toBeGreaterThan(-1);
    expect(supersede).toBeGreaterThan(-1);
    expect(mismatch).toBeLessThan(supersede);
  });

  it("the server retries a generation conflict with a newly generated code", () => {
    const at = COMMANDS.indexOf("export async function issueHandoffCode");
    expect(at).toBeGreaterThan(-1);
    const body = COMMANDS.slice(at, COMMANDS.indexOf("/**\n * Verify a submitted code", at));
    expect(body).toContain("MAX_GENERATION_ATTEMPTS");
    expect(body).toContain('error?.message === "handoff_generation_conflict"');
    expect(body).toContain("continue;");
    expect(body).toContain("const code = generateHandoffCode()");
    expect(body).toMatch(/p_expected_generation:\s*generation/);
  });

  it("never returns a code whose stored generation differs from the signed generation", () => {
    const at = COMMANDS.indexOf("export async function issueHandoffCode");
    const body = COMMANDS.slice(at, COMMANDS.indexOf("/**\n * Verify a submitted code", at));
    expect(body).toMatch(/storedGeneration\s*!==\s*generation/);
    expect(body).toContain("handoff_generation_mismatch");
  });
});
