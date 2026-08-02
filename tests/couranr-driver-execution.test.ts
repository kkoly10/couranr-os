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

describe("handoff codes", () => {
  const SAVED = process.env.COURANR_HANDOFF_CODE_SECRET;
  beforeEach(() => {
    process.env.COURANR_HANDOFF_CODE_SECRET = "test-secret-not-a-real-key";
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
    expect(pickup).not.toBe(recipient);
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
      expect(e.message).not.toContain("test-secret-not-a-real-key");
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

  it("gives every state a label and a tone, and only delivered is success", () => {
    for (const s of FULFILLMENT_STATES) {
      expect(FULFILLMENT_TONES[s], `${s} has no tone`).toBeDefined();
    }
    const success = FULFILLMENT_STATES.filter((s) => FULFILLMENT_TONES[s] === "success");
    expect(success).toEqual(["delivered"]);
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
