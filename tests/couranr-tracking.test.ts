import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  buildTrackingProjection,
  isCustomerVisibleProof,
  proofStateFor,
  TRACKING_PROJECTION_ALLOWED_KEYS,
  TRACKING_PROJECTION_FORBIDDEN_SUBSTRINGS,
} from "@/lib/couranr/tracking/projection";
import {
  isTrackingRefusal,
  REFUSAL_COPY,
  stageForFulfillmentState,
  stageForRequest,
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_RAIL,
  STAGE_TONES,
  TRACKING_REFUSALS,
  TRACKING_STAGES,
  UNREACHABLE_STAGES,
  type TrackingStage,
} from "@/lib/couranr/tracking/states";
import { FULFILLMENT_STATES } from "@/lib/couranr/driver/states";

const REPO = path.resolve(__dirname, "..");

/* =====================================================================
 * Vocabulary
 * ===================================================================== */

describe("tracking vocabulary", () => {
  it("covers PUB-006's required states", () => {
    // The registry's list, verbatim: Preparing; confirmed; assigned; picked up;
    // in transit; at drop-off; delivered; return; proof processing.
    // "Proof processing" is a proof state, asserted separately below.
    for (const required of [
      "preparing",
      "confirmed",
      "assigned",
      "picked_up",
      "in_transit",
      "at_dropoff",
      "delivered",
      "return",
    ]) {
      expect(TRACKING_STAGES).toContain(required);
    }
  });

  it("gives every stage a label, a description, a tone and an order", () => {
    for (const s of TRACKING_STAGES) {
      expect(STAGE_LABELS[s], `label for ${s}`).toBeTruthy();
      expect(STAGE_DESCRIPTIONS[s], `description for ${s}`).toBeTruthy();
      expect(STAGE_TONES[s], `tone for ${s}`).toBeTruthy();
      expect(typeof STAGE_ORDER[s], `order for ${s}`).toBe("number");
    }
  });

  it("marks only `delivered` as success", () => {
    const success = TRACKING_STAGES.filter((s) => STAGE_TONES[s] === "success");
    expect(success).toEqual(["delivered"]);
  });

  it("keeps terminal exceptions off the progress rail", () => {
    // A cancelled delivery must not render as "step 6 of 6 complete".
    expect(STAGE_RAIL).not.toContain("cancelled");
    expect(STAGE_RAIL).not.toContain("could_not_deliver");
    expect(STAGE_RAIL).not.toContain("return");
  });

  it("never promises a time in any stage copy", () => {
    // PUB-006's mandatory correction is that times are estimates. The estimate
    // is rendered separately and labelled; the stage sentence never carries one.
    for (const s of TRACKING_STAGES) {
      const copy = `${STAGE_LABELS[s]} ${STAGE_DESCRIPTIONS[s]}`.toLowerCase();
      for (const banned of ["minute", "hour", "eta", "by 5", "guarantee", "on time", "on-time"]) {
        expect(copy, `${s} copy mentions "${banned}"`).not.toContain(banned);
      }
    }
  });

  it("uses no founder or personal-operator language", () => {
    // TRM-001. The tracking page is the surface a stranger is most likely to
    // forward, so the institutional voice matters most here.
    const all = TRACKING_STAGES.map((s) => `${STAGE_LABELS[s]} ${STAGE_DESCRIPTIONS[s]}`)
      .concat(REFUSAL_COPY)
      .join(" ")
      .toLowerCase();
    for (const banned of ["24/7", "guarantee", "buyer protection", "my team", "i will", "we promise"]) {
      expect(all, `copy contains "${banned}"`).not.toContain(banned);
    }
  });
});

/* =====================================================================
 * The stored-state mapping
 * ===================================================================== */

describe("stage mapping", () => {
  it("maps every stored fulfillment state to a stage", () => {
    // Exhaustive over the shipped vocabulary. A state added to
    // FULFILLMENT_STATES without a line in the map fails here rather than
    // silently falling back to a request-derived stage on a live page.
    for (const s of FULFILLMENT_STATES) {
      expect(stageForFulfillmentState(s), `no stage for ${s}`).not.toBeNull();
    }
  });

  it("returns null rather than guessing for an unknown state", () => {
    expect(stageForFulfillmentState("teleported")).toBeNull();
    expect(stageForFulfillmentState(null)).toBeNull();
    expect(stageForFulfillmentState(undefined)).toBeNull();
    expect(stageForFulfillmentState(7)).toBeNull();
  });

  it("collapses the pre-pickup driver states into one customer stage", () => {
    expect(stageForFulfillmentState("assigned")).toBe("assigned");
    expect(stageForFulfillmentState("en_route_to_pickup")).toBe("assigned");
    expect(stageForFulfillmentState("at_pickup")).toBe("assigned");
  });

  it("does not paint a waypoint as an achievement", () => {
    expect(stageForFulfillmentState("at_dropoff")).toBe("at_dropoff");
    expect(STAGE_TONES[stageForFulfillmentState("at_dropoff") as TrackingStage]).not.toBe("success");
  });

  /**
   * The executable record of a KNOWN GAP.
   *
   * `02_DECISION_REGISTRY.json` STA-002 declares fourteen fulfillment values
   * including `return_required`, `returning` and `returned`. The shipped
   * vocabulary has ten and none of those, because returns and refunds (P6-004,
   * P7-005) have not started. So the `return` stage is declared and currently
   * unreachable, and this test says so out loud.
   *
   * WHEN THIS TEST FAILS, returns have shipped — update the ledger and delete it.
   */
  it("cannot reach the `return` stage from any state the database can hold today", () => {
    const reachable = new Set(
      FULFILLMENT_STATES.map((s) => stageForFulfillmentState(s)).filter(Boolean)
    );
    for (const unreachable of UNREACHABLE_STAGES) {
      expect(reachable.has(unreachable), `${unreachable} is now reachable`).toBe(false);
    }
  });

  it("derives a pre-delivery stage from the request", () => {
    // A delivery row exists only after payment capture, so these two stages are
    // necessarily request-derived.
    expect(stageForRequest({ requestState: "confirmed" })).toBe("confirmed");
    expect(stageForRequest({ requestState: "confirmed", readinessState: "preparing" })).toBe(
      "preparing"
    );
    expect(stageForRequest({ requestState: "cancelled" })).toBe("cancelled");
    expect(stageForRequest({ requestState: "declined" })).toBe("cancelled");
  });
});

/* =====================================================================
 * Refusals
 * ===================================================================== */

describe("refusals", () => {
  it("recognises exactly the three the SQL can return", () => {
    expect([...TRACKING_REFUSALS]).toEqual(["not_found", "revoked", "expired"]);
    for (const r of TRACKING_REFUSALS) expect(isTrackingRefusal(r)).toBe(true);
    expect(isTrackingRefusal("quote_changed")).toBe(false);
    expect(isTrackingRefusal(null)).toBe(false);
  });

  it("has ONE refusal sentence, so the screen cannot distinguish them", () => {
    // PHO-001: an unauthorized caller receives the same response as for a
    // missing delivery. A per-reason copy map would leak that a link once
    // existed. `REFUSAL_COPY` is a string, not a record — this asserts that.
    expect(typeof REFUSAL_COPY).toBe("string");
    expect(REFUSAL_COPY.toLowerCase()).not.toContain("expired");
    expect(REFUSAL_COPY.toLowerCase()).not.toContain("revoked");
  });
});

/* =====================================================================
 * The projection — the security boundary
 * ===================================================================== */

/** A row set with a value in every field the projection could possibly reach. */
function fixture(overrides: Record<string, any> = {}) {
  return {
    request: {
      id: "11111111-1111-4111-8111-111111111111",
      request_state: "confirmed",
      readiness_state: "ready",
      ...(overrides.request ?? {}),
    },
    delivery:
      overrides.delivery === null
        ? null
        : {
            id: "22222222-2222-4222-8222-222222222222",
            fulfillment_state: "in_transit",
            service_level: "standard",
            signature_required: true,
            proof_method: "signature",
            scheduled_pickup_start: "2026-08-04T14:00:00.000Z",
            scheduled_pickup_end: "2026-08-04T16:00:00.000Z",
            timezone: "America/New_York",
            dropoff_address: {
              line1: "18 Rowan Court",
              line2: "Apt 4",
              city: "Stafford",
              region: "VA",
              postalCode: "22554",
              instructions: "Gate code 8891, keypad on the left",
            },
            ...(overrides.delivery ?? {}),
          },
    business: { id: "33333333-3333-4333-8333-333333333333", name: "Rowan & Fig", ...(overrides.business ?? {}) },
    assignmentActive: overrides.assignmentActive ?? true,
    proofs: overrides.proofs ?? [],
    events: overrides.events ?? [],
  };
}

describe("tracking projection", () => {
  it("emits exactly the allowed top-level keys", () => {
    const p = buildTrackingProjection(fixture());
    expect(Object.keys(p).sort()).toEqual([...TRACKING_PROJECTION_ALLOWED_KEYS].sort());
  });

  it("never serializes a forbidden name at any depth", () => {
    const p = buildTrackingProjection(
      fixture({
        proofs: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            proof_stage: "dropoff",
            proof_type: "delivery_photo",
            storage_bucket: "delivery-proof",
            storage_object_path: "d/22222222/dropoff/photo.jpg",
            captured_latitude: 38.42,
            captured_longitude: -77.4,
            finalized_at: "2026-08-04T17:04:00.000Z",
          },
        ],
        events: [
          {
            to_state: "in_transit",
            created_at: "2026-08-04T16:30:00.000Z",
            actor_user_id: "55555555-5555-4555-8555-555555555555",
            command: "start_route_to_dropoff",
            metadata: { internal_note: "merchant called" },
          },
        ],
      })
    );
    const json = JSON.stringify(p);
    for (const banned of TRACKING_PROJECTION_FORBIDDEN_SUBSTRINGS) {
      expect(json, `projection leaked "${banned}"`).not.toContain(banned);
    }
  });

  it("withholds the dropoff instructions even though it returns the address", () => {
    // CUS-008: gate codes and sensitive instructions are for the assigned
    // driver and Couranr. A tracking link travels; the instruction does not.
    const p = buildTrackingProjection(fixture());
    expect(p.dropoff.line1).toBe("18 Rowan Court");
    expect(JSON.stringify(p)).not.toContain("8891");
    expect(JSON.stringify(p)).not.toContain("keypad");
  });

  it("returns the fact of a driver and never the driver", () => {
    const p = buildTrackingProjection(fixture({ assignmentActive: true }));
    expect(p.driverAssigned).toBe(true);
    expect(JSON.stringify(p).toLowerCase()).not.toContain("driver_id");
    expect(JSON.stringify(p).toLowerCase()).not.toContain("firstname");
  });

  it("renders a request with no delivery row as a real stage, not an error", () => {
    // A delivery row exists only after payment capture. Between confirmation
    // and capture the link is live and must show progress.
    // `assignmentActive: false` mirrors the loader, which never queries
    // assignments when there is no delivery id to scope them to.
    const p = buildTrackingProjection(fixture({ delivery: null, assignmentActive: false }));
    expect(p.stage).toBe("confirmed");
    expect(p.sourceState).toBeNull();
    expect(p.scheduledPickupStart).toBeNull();
    expect(p.driverAssigned).toBe(false);
    expect(p.proof.state).toBe("unavailable");
  });

  it("prefers the delivery's state over the request's once one exists", () => {
    const p = buildTrackingProjection(fixture());
    expect(p.stage).toBe("in_transit");
    expect(p.sourceState).toBe("in_transit");
  });

  it("falls back to the request when the stored state is unrecognised", () => {
    // Fail-closed: an invented stage is a sentence told to a customer that
    // nothing verified.
    const p = buildTrackingProjection(fixture({ delivery: { fulfillment_state: "teleported" } }));
    expect(p.stage).toBe("confirmed");
  });
});

/* =====================================================================
 * Proof
 * ===================================================================== */

describe("proof visibility", () => {
  it("admits dropoff proof and nothing else", () => {
    expect(isCustomerVisibleProof({ proof_stage: "dropoff" })).toBe(true);
    expect(isCustomerVisibleProof({ proof_stage: "pickup" })).toBe(false);
    expect(isCustomerVisibleProof({ proof_stage: "pickup_discrepancy" })).toBe(false);
    expect(isCustomerVisibleProof({})).toBe(false);
    expect(isCustomerVisibleProof(null)).toBe(false);
  });

  it("drops pickup evidence from the projection", () => {
    const p = buildTrackingProjection(
      fixture({
        delivery: { fulfillment_state: "delivered" },
        proofs: [
          {
            id: "aaaaaaa1-0000-4000-8000-000000000001",
            proof_stage: "pickup",
            proof_type: "condition_photo",
            storage_object_path: "p/1.jpg",
            finalized_at: "2026-08-04T14:10:00.000Z",
          },
          {
            id: "aaaaaaa1-0000-4000-8000-000000000002",
            proof_stage: "pickup_discrepancy",
            proof_type: "discrepancy_evidence",
            storage_object_path: "p/2.jpg",
            finalized_at: "2026-08-04T14:12:00.000Z",
          },
          {
            id: "aaaaaaa1-0000-4000-8000-000000000003",
            proof_stage: "dropoff",
            proof_type: "delivery_photo",
            storage_object_path: "p/3.jpg",
            finalized_at: "2026-08-04T17:00:00.000Z",
          },
        ],
      })
    );
    expect(p.proof.items).toHaveLength(1);
    expect(p.proof.items[0].proofType).toBe("delivery_photo");
    expect(p.proof.state).toBe("available");
  });

  it("reports `processing` for a delivered delivery whose proof has not landed", () => {
    // Completion and proof finalization are separate writes, so this window is
    // real. `unavailable` here would tell a customer their delivery has no
    // proof seconds before it has some.
    expect(proofStateFor({ stage: "delivered", visibleProofCount: 0 })).toBe("processing");
    expect(proofStateFor({ stage: "delivered", visibleProofCount: 1 })).toBe("available");
    expect(proofStateFor({ stage: "in_transit", visibleProofCount: 0 })).toBe("unavailable");
  });

  it("marks a PIN record as proof without an image", () => {
    const p = buildTrackingProjection(
      fixture({
        delivery: { fulfillment_state: "delivered" },
        proofs: [
          {
            id: "aaaaaaa1-0000-4000-8000-000000000004",
            proof_stage: "dropoff",
            proof_type: "recipient_pin",
            storage_object_path: null,
            finalized_at: "2026-08-04T17:00:00.000Z",
          },
        ],
      })
    );
    expect(p.proof.items[0].hasImage).toBe(false);
    expect(p.proof.state).toBe("available");
  });
});

/* =====================================================================
 * Timeline
 * ===================================================================== */

describe("timeline", () => {
  it("keeps the first occurrence of each customer stage", () => {
    // Three stored states collapse to `assigned`; the rail must show it once.
    const t = buildTimeline([
      { to_state: "assigned", created_at: "2026-08-04T13:00:00.000Z" },
      { to_state: "en_route_to_pickup", created_at: "2026-08-04T13:30:00.000Z" },
      { to_state: "at_pickup", created_at: "2026-08-04T13:50:00.000Z" },
      { to_state: "picked_up", created_at: "2026-08-04T14:05:00.000Z" },
    ]);
    expect(t.map((e) => e.stage)).toEqual(["assigned", "picked_up"]);
    expect(t[0].at).toBe("2026-08-04T13:00:00.000Z");
  });

  it("drops entries it cannot map or date", () => {
    const t = buildTimeline([
      { to_state: "teleported", created_at: "2026-08-04T13:00:00.000Z" },
      { to_state: "delivered", created_at: null },
      { to_state: "delivered", created_at: "2026-08-04T17:00:00.000Z" },
    ]);
    expect(t).toEqual([{ stage: "delivered", at: "2026-08-04T17:00:00.000Z" }]);
  });

  it("carries nothing but a stage and a time", () => {
    const t = buildTimeline([
      {
        to_state: "delivered",
        created_at: "2026-08-04T17:00:00.000Z",
        actor_user_id: "55555555-5555-4555-8555-555555555555",
        command: "complete_signature_delivery",
        metadata: { signerName: "R. Alvarez" },
      },
    ]);
    expect(Object.keys(t[0]).sort()).toEqual(["at", "stage"]);
    expect(JSON.stringify(t)).not.toContain("Alvarez");
  });

  it("tolerates a non-array", () => {
    expect(buildTimeline(null as any)).toEqual([]);
    expect(buildTimeline(undefined as any)).toEqual([]);
  });
});

/* =====================================================================
 * Source-level guarantees
 * ===================================================================== */

describe("the tracking command layer is read-only", () => {
  const src = fs.readFileSync(path.join(REPO, "lib/couranr/tracking/commands.ts"), "utf8");

  it("contains no write against a delivery, request, payment or proof", () => {
    // A customer-held token reaches exactly one write: the `last_used_at` stamp
    // the redeem function makes on the token's own row, inside SQL. Nothing in
    // this module may add a second.
    for (const banned of [".update(", ".insert(", ".upsert(", ".delete("]) {
      expect(src, `commands.ts contains ${banned}`).not.toContain(banned);
    }
  });

  it("never selects every column", () => {
    // `select("*")` would read the payment obligation id and the pricing policy
    // version into the process and leave the allow-list as the only thing
    // between them and a URL that forwards.
    expect(src).not.toMatch(/\.select\(\s*["'`]\*/);
  });

  it("collapses every refusal to not_found before it reaches a caller", () => {
    expect(src).toContain('resolved: false, reason: "not_found"');
    // The distinguishing strings exist in the SQL and in the vocabulary, but
    // this module must never branch on them to build a response.
    expect(src).not.toContain('reason: "expired"');
    expect(src).not.toContain('reason: "revoked"');
  });
});

describe("access token primitives are shared, not copied", () => {
  it("payments and tracking hash identically, and to the SAME KNOWN VALUE", async () => {
    const payments = await import("@/lib/couranr/payments/tokens");
    const tracking = await import("@/lib/couranr/tracking/tokens");
    const raw = "couranr-token-hash-fixture";

    // Agreement alone is tautological now that both delegate to one primitive:
    // changing the shared implementation would keep them equal and break every
    // live link, because the database holds hashes produced by the OLD one.
    // The literal is the real assertion.
    const known = "90b0bc72f85dd91e4c6d124ceb863d23690b5c9e712958a6e23ea8bbc6204ab6";
    expect(payments.hashPaymentToken(raw)).toBe(known);
    expect(tracking.hashTrackingToken(raw)).toBe(known);
  });

  it("generates 256 bits, url-safe, and accepts its own output", async () => {
    const tracking = await import("@/lib/couranr/tracking/tokens");
    const t = tracking.generateTrackingToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes base64url is 43 characters.
    expect(t).toHaveLength(43);
    expect(tracking.isWellFormedTrackingToken(t)).toBe(true);
  });

  it("rejects anything that is not base64url before a hash is computed", async () => {
    const tracking = await import("@/lib/couranr/tracking/tokens");
    for (const bad of ["", "short", "has space", "has/slash", "has+plus", null, 7, {}]) {
      expect(tracking.isWellFormedTrackingToken(bad as any), `accepted ${String(bad)}`).toBe(false);
    }
  });

  it("keeps the tracking TTL longer than the payment TTL and clamped in SQL", async () => {
    const payments = await import("@/lib/couranr/payments/tokens");
    const tracking = await import("@/lib/couranr/tracking/tokens");
    expect(tracking.TRACKING_TOKEN_TTL_DAYS).toBeGreaterThan(payments.TOKEN_TTL_DAYS);

    // The SQL clamp is the real ceiling; this asserts the two agree, because a
    // constant larger than the clamp would silently issue shorter links than
    // the code claims.
    const sql = fs.readFileSync(
      path.join(REPO, "supabase/migrations/20260804090000_couranr_delivery_access_tokens.sql"),
      "utf8"
    );
    expect(sql).toContain(
      `least(greatest(coalesce(p_ttl_days, ${tracking.TRACKING_TOKEN_TTL_DAYS}), 1), ${tracking.TRACKING_TOKEN_TTL_DAYS})`
    );
  });
});

describe("the migration keeps the project's grant discipline", () => {
  const sql = fs.readFileSync(
    path.join(REPO, "supabase/migrations/20260804090000_couranr_delivery_access_tokens.sql"),
    "utf8"
  );

  it("revokes before it grants, on the table and on every function", () => {
    // pg_default_acl grants ALL to anon, authenticated AND service_role on
    // every new object in `public`, so a bare additive grant enforces nothing.
    expect(sql).toContain(
      "revoke all on public.couranr_delivery_access_tokens from public, anon, authenticated;"
    );
    expect(sql).toContain(
      "revoke all on public.couranr_delivery_access_tokens from service_role;"
    );
    const revokes = sql.match(/revoke all on function/g) ?? [];
    const grants = sql.match(/grant execute on function/g) ?? [];
    expect(revokes.length).toBe(3);
    expect(grants.length).toBe(3);
  });

  it("never grants delete on the token table", () => {
    // A revoked link stays auditable.
    expect(sql).toContain("grant select, insert, update on public.couranr_delivery_access_tokens to service_role;");
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*couranr_delivery_access_tokens/);
  });

  it("enables RLS and adds no policy", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("create policy");
  });

  it("declares every function SECURITY INVOKER with an empty search_path", () => {
    const fns = sql.match(/^security invoker$/gm) ?? [];
    // Line-anchored: the header comment quotes the same clause, and counting
    // that as an enforcement point would let a function ship without one.
    const paths = sql.match(/^set search_path = ''$/gm) ?? [];
    expect(fns.length).toBe(3);
    expect(paths.length).toBe(3);
    expect(sql).not.toContain("security definer");
  });

  it("stores a hash and refuses anything that is not one", () => {
    expect(sql).toContain("check (token_hash ~ '^[0-9a-f]{64}$')");
  });

  it("has a rollback that refuses while links are live", () => {
    const rb = fs.readFileSync(
      path.join(REPO, "supabase/migrations/20260804090000_couranr_delivery_access_tokens.rollback.sql"),
      "utf8"
    );
    expect(rb).toContain("refusing to drop couranr_delivery_access_tokens");
    // Matched on the statement PREFIX, not the whole line: an explicit
    // RESTRICT was added to every table drop in every rollback, and an
    // assertion pinned to the exact terminating semicolon broke on a change
    // that made the file strictly safer.
    expect(rb).toMatch(
      /drop table if exists public\.couranr_delivery_access_tokens\s+restrict;/
    );
  });
});

/* =====================================================================
 * Landmarks
 * ===================================================================== */

describe("no canonical page nests a second main landmark", () => {
  /**
   * The shells already render `<main id="cr-main">`. Two public pages nested a
   * second `<main>` inside it, which is invalid and leaves assistive technology
   * with no single "the content" target. A browser run found it — nothing in
   * typecheck, lint or 1091 unit tests could have.
   *
   * Scoped to the canonical `app/(couranr)` tree. The legacy auto and docs
   * pages are quarantine targets and are not this rule's business.
   */
  function pageFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) pageFiles(full, out);
      else if (entry === "page.tsx" || entry === "layout.tsx") out.push(full);
    }
    return out;
  }

  const CANONICAL_APP = path.join(REPO, "app/(couranr)");
  const files = pageFiles(CANONICAL_APP);

  it("finds the pages it is meant to police", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("declares <main> only in a layout, never in a page", () => {
    // Comments stripped first: both fixed pages EXPLAIN the rule in prose that
    // quotes `<main id="cr-main">`, and matching that would fail the file that
    // documents why it complies.
    const code = (f: string) =>
      fs
        .readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    const offenders = files
      .filter((f) => path.basename(f) === "page.tsx")
      .filter((f) => /<main[\s>]/.test(code(f)))
      .map((f) => path.relative(REPO, f));
    expect(offenders, `pages nesting a second <main>:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
