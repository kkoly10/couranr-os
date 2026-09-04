import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_KINDS,
  VISIBILITIES,
  canAddress,
  type ParticipantKind,
  type Visibility,
} from "@/lib/couranr/conversations/states";

const ROOT = path.resolve(__dirname, "..");
const D0 = readFileSync(
  path.join(
    ROOT,
    "supabase/migrations/20260904210000_couranr_driver_pilot_authority_d0.sql"
  ),
  "utf8"
);
const COMMANDS = readFileSync(
  path.join(ROOT, "lib/couranr/conversations/commands.ts"),
  "utf8"
);
const AUTO = readFileSync(
  path.join(ROOT, "supabase/migrations/20260904152329_couranr_automatic_fulfillment_v1.sql"),
  "utf8"
);
const CONTRACT = readFileSync(
  path.join(ROOT, "docs/couranr-mvp/DRIVER_PILOT_READINESS_D0.md"),
  "utf8"
);

describe("D0 human message addressing authority", () => {
  const allowed: Record<ParticipantKind, Visibility[]> = {
    operations: [
      "participants",
      "couranr_internal",
      "driver_and_couranr",
      "merchant_and_couranr",
    ],
    driver: ["participants", "driver_and_couranr"],
    merchant: ["participants", "merchant_and_couranr"],
    customer: ["participants"],
  };

  it("matches the closed actor x visibility matrix exactly", () => {
    for (const actor of PARTICIPANT_KINDS) {
      for (const visibility of VISIBILITIES) {
        expect(
          canAddress(actor, visibility),
          `${actor} -> ${visibility}`
        ).toBe(allowed[actor].includes(visibility));
      }
    }
  });

  it("the named server command checks addressing before any message INSERT", () => {
    const sendStart = COMMANDS.indexOf("export async function sendMessage");
    expect(sendStart).toBeGreaterThanOrEqual(0);
    const body = COMMANDS.slice(sendStart);
    const gate = body.indexOf(
      "canAddress(participant.value.participantKind, visibility)"
    );
    const insert = body.indexOf('.from("couranr_conversation_messages")');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(insert);
    expect(body).toContain('code: "not_permitted"');
  });

  it("the database repeats the actor permission instead of trusting UI hiding", () => {
    expect(D0).toContain("couranr_cv_actor_visibility_allowed");
    expect(D0).toContain("couranr_cvm_enforce_author_addressing");
    expect(D0).toContain("message_visibility_not_permitted");
    expect(D0).toContain("using errcode = 'CR403'");
    expect(D0).toContain("v_left_at is not null");
    expect(D0).toContain("v_conversation_id is distinct from new.conversation_id");
    expect(D0).toMatch(
      /when 'driver' then p_visibility in \(\s*'participants',\s*'driver_and_couranr'\s*\)/s
    );
    expect(D0).toMatch(
      /when 'merchant' then p_visibility in \(\s*'participants',\s*'merchant_and_couranr'\s*\)/s
    );
    expect(D0).toMatch(/when 'customer' then p_visibility = 'participants'/);
  });
});

describe("D0 availability intent authority", () => {
  it("adds a two-value preference without inventing a fourth operational state", () => {
    expect(D0).toContain("add column if not exists availability_preference");
    expect(D0).toContain(
      "check (availability_preference in ('available','unavailable'))"
    );
    expect(D0).not.toContain("'busy'");
  });

  it("preserves on_delivery as system truth and intercepts an unsafe release", () => {
    expect(D0).toContain("old.availability_state = 'on_delivery'");
    expect(D0).toContain("old.availability_preference = 'unavailable'");
    expect(D0).toContain("new.availability_state := 'unavailable'");
    expect(D0).not.toContain("new.availability_state := 'on_delivery'");
  });

  it("does not create a second automatic-dispatch eligibility source", () => {
    expect(AUTO).toContain("d.availability_state='available'");
    expect(AUTO).not.toContain("availability_preference");
  });
});

describe("D0 scope control", () => {
  it("locks delivery-chat issuance to canonical delivery existence", () => {
    expect(CONTRACT).toContain(
      "after the canonical `couranr_deliveries`\nrow exists"
    );
    expect(CONTRACT).toContain("Messaging failure must never roll back creation");
  });

  it("does not smuggle deferred Driver product into the authority batch", () => {
    for (const deferred of [
      "no weekly shift planner",
      "no gig marketplace",
      "no multi-vehicle preference model",
      "no new paid API",
      "no PWA/service-worker dependency",
    ]) {
      expect(CONTRACT).toContain(deferred);
    }
  });
});
